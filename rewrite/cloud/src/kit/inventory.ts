import { COLLECTIONS } from '@ldrw/shared'
import { getDb } from './db'

// 实物库存原子原语（设计约束#1「下单即预留+乐观 CAS 防超卖」·黄金 inventory-scm §A/§B/§C）。
// SKU 库存独立集合 inventory，确定性 _id=`${productId}__${spec}`（与 order.items[].spec 同键，回补一致）。
// 不限量：无文档或 stock=null＝不限量（缺货前不阻断下单·安全迁移）。
// 单一收口：全库仅本文件读写 inventory.stock。getInventory（批14）/produceStock（批16 SCM）已随域批次补齐。

export interface StockLine {
  productId: string
  spec: string
  qty: number
}

const CAS_RETRY = 5
const idOf = (productId: string, spec: string) => `${productId}__${spec || ''}`

// 单条 CAS 扣减：true=已扣 / false=库存不足 / null=不限量（不扣不计）
async function casDecrement(coll: any, _id: string, qty: number): Promise<boolean | null> {
  for (let i = 0; i < CAS_RETRY; i++) {
    const got = await coll
      .doc(_id)
      .get()
      .catch(() => null)
    if (!got || !got.data) return null
    const stock = got.data.stock
    if (stock == null) return null
    if (stock < qty) return false
    const r = await coll
      .where({ _id, stock })
      .update({ data: { stock: stock - qty, updatedAt: Date.now() } })
      .catch(() => ({ stats: { updated: 0 } }))
    if (r.stats && r.stats.updated === 1) return true
  }
  return false // 重试耗尽按不足处理·宁缺勿超卖
}

async function casIncrement(coll: any, _id: string, qty: number): Promise<void> {
  for (let i = 0; i < CAS_RETRY; i++) {
    const got = await coll
      .doc(_id)
      .get()
      .catch(() => null)
    if (!got || !got.data) return
    const stock = got.data.stock
    if (stock == null) return
    const r = await coll
      .where({ _id, stock })
      .update({ data: { stock: stock + qty, updatedAt: Date.now() } })
      .catch(() => ({ stats: { updated: 0 } }))
    if (r.stats && r.stats.updated === 1) return
  }
}

/**
 * 下单原子预留：逐条 CAS 扣减。任一不足→回滚本单已扣、返回 short 指明短缺条目（整单全有或全无）。
 * 不限量条目不扣、不计入 reserved（回补也不处理）。reserved 写进订单供超时/退款回补。
 */
export async function reserveStock(
  lines: StockLine[]
): Promise<{ ok: boolean; reserved: StockLine[]; short?: StockLine }> {
  const coll = getDb().collection(COLLECTIONS.inventory)
  const reserved: StockLine[] = []
  for (const l of lines) {
    if (!l.productId || !(l.qty > 0)) continue
    const got = await casDecrement(coll, idOf(l.productId, l.spec), l.qty)
    if (got === null) continue
    if (got === false) {
      await restoreStock(reserved)
      return { ok: false, reserved: [], short: l }
    }
    reserved.push({ productId: l.productId, spec: l.spec, qty: l.qty })
  }
  return { ok: true, reserved }
}

/** 回补库存（超时关单/退款/建单失败回滚）。幂等由调用方绑状态转移保证（只在抢占成功后调一次）。 */
export async function restoreStock(lines: StockLine[]): Promise<void> {
  if (!lines || !lines.length) return
  const coll = getDb().collection(COLLECTIONS.inventory)
  for (const l of lines) {
    if (l && l.productId && l.qty > 0) await casIncrement(coll, idOf(l.productId, l.spec), l.qty)
  }
}

/**
 * 管理端设/调库存（绝对值）。stock=null＝不限量。
 * expectedUpdatedAt 提供时走条件写（CAS 防覆盖并发预留）：期间被预留/他人改动推进过即回 conflict，
 * 管理端刷新重试、绝不把并发扣减覆盖回旧值（超卖窗口）。省略＝上新/首设走 upsert。
 */
export async function setStock(
  productId: string,
  spec: string,
  stock: number | null,
  threshold?: number,
  expectedUpdatedAt?: number | null
): Promise<{ ok: boolean; conflict?: boolean }> {
  const coll = getDb().collection(COLLECTIONS.inventory)
  const _id = idOf(productId, spec)
  const data: Record<string, unknown> = { productId, spec, stock, updatedAt: Date.now() }
  if (threshold != null) data.threshold = threshold
  if (expectedUpdatedAt != null) {
    const r = await coll
      .where({ _id, updatedAt: expectedUpdatedAt })
      .update({ data })
      .catch(() => ({ stats: { updated: 0 } }))
    if (r.stats && r.stats.updated === 1) return { ok: true }
    return { ok: false, conflict: true }
  }
  await coll
    .doc(_id)
    .set({ data })
    .catch(async () => {
      await coll.add({ data: { _id, ...data } })
    })
  return { ok: true }
}

/**
 * 组装入成品（进销存 SCM 门4·旧线 kit/inventory 逐字承接·批16）：
 * CAS 增·无文档则建（组装出来的成品第一次入账时 SKU 可能还没建库存档）。stock=null（不限量）保持不动——
 * 不把「不限量」隐式翻成限量（改计量语义须管理员在库存页显式设置）。qty 非正整数 fail-closed。
 */
export async function produceStock(productId: string, spec: string, qty: number): Promise<{ ok: boolean; error?: string }> {
  if (!productId || !Number.isInteger(qty) || qty <= 0) return { ok: false, error: 'BAD_QTY' }
  const coll = getDb().collection(COLLECTIONS.inventory)
  const _id = idOf(productId, spec)
  for (let i = 0; i < CAS_RETRY; i++) {
    const got = await coll.doc(_id).get().catch(() => null)
    if (!got || !got.data) {
      // 无文档则建（确定性 _id·并发双建一方撞 DUPLICATE 走下轮 CAS 累加）
      const created = await coll
        .add({ data: { _id, productId, spec, stock: qty, updatedAt: Date.now() } })
        .then(() => true)
        .catch(() => false)
      if (created) return { ok: true }
      continue
    }
    const stock = got.data.stock
    if (stock == null) return { ok: true } // 不限量：入成品无账可加·保持不限量
    const r = await coll
      .where({ _id, stock })
      .update({ data: { stock: stock + qty, updatedAt: Date.now() } })
      .catch(() => ({ stats: { updated: 0 } }))
    if (r.stats && r.stats.updated === 1) return { ok: true }
    // updated:0＝并发改动→重读重试
  }
  return { ok: false, error: 'CONTENTION' } // 争用耗尽（管理端低频·几乎不至）
}

// 全量扫描上限（黄金 inventory-scm §L）：裸 .get() 服务端默认 100 条静默截断——SKU 破百后库存页
// 少显示像没记录。分页取齐（100/页）、封顶防无界；到顶如实报 truncated（调用方提示、不装全量）。
export const INVENTORY_SCAN_CAP = 1000

/** 读库存（管理端列表/看板低库存）。productIds 为空＝全量（分页取齐·封顶）。 */
export async function getInventory(productIds?: string[]): Promise<{ list: any[]; truncated: boolean }> {
  const coll = getDb().collection(COLLECTIONS.inventory)
  const base = productIds && productIds.length ? coll.where({ productId: getDb().command.in(productIds) }) : coll
  const PAGE = 100
  const list: any[] = []
  for (let skip = 0; skip < INVENTORY_SCAN_CAP; skip += PAGE) {
    const r = await base
      .orderBy('productId', 'asc')
      .skip(skip)
      .limit(PAGE)
      .get()
      .catch(() => ({ data: [] }))
    const rows: any[] = (r && r.data) || []
    list.push(...rows)
    if (rows.length < PAGE) return { list, truncated: false }
  }
  return { list, truncated: true }
}

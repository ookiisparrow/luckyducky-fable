import { getDb } from './db'
import { COLLECTIONS } from './collections'

// 实物库存原子原语（库存#1·根因#1/#2 并发正确性）。SKU 库存独立集合 `inventory`，确定性 _id=`${productId}__${spec}`
// （spec=下单条目规格名·与 order.items[].spec 同键，回补/退款一致）。
//
// **下单即预留 + 乐观 CAS 防超卖**：读 stock → `where({_id, stock:读值}).update(set stock−qty)`，仅当库存未被并发
// 改动那次改得到（updated===1）；被改→重读重试。杜绝「读后写」超卖（抢最后一件只一个赢）。**不用 _.inc/_.gte**
// （测试桩与本仓 CAS 范式只用精确匹配 where + 绝对值 set·同 transition）。
// **不限量**：无 inventory 文档或 stock=null＝不限量（现有商品零改动·安全迁移，缺货前不阻断下单）。
// **单一收口**（守卫 stock-atomic-conditional）：全库仅本文件读写 inventory.stock；admin 经 setStock、下单经 reserveStock。

export interface StockLine {
  productId: string
  spec: string
  qty: number
}

const CAS_RETRY = 5
const idOf = (productId: string, spec: string) => `${productId}__${spec || ''}`

// 单条 CAS 扣减：true=已扣 / false=库存不足 / null=不限量(无文档或 stock=null·不扣不计)
async function casDecrement(coll: any, _id: string, qty: number): Promise<boolean | null> {
  for (let i = 0; i < CAS_RETRY; i++) {
    const got = await coll.doc(_id).get().catch(() => null)
    if (!got || !got.data) return null
    const stock = got.data.stock
    if (stock == null) return null
    if (stock < qty) return false
    const r = await coll
      .where({ _id, stock })
      .update({ data: { stock: stock - qty, updatedAt: Date.now() } })
      .catch(() => ({ stats: { updated: 0 } }))
    if (r.stats && r.stats.updated === 1) return true
    // updated:0＝并发改动→重读重试
  }
  return false // 重试耗尽（极高并发争用）按不足处理·宁缺勿超卖
}

// 单条 CAS 回补（加回）：不限量/无文档跳过；并发冲突重试
async function casIncrement(coll: any, _id: string, qty: number): Promise<void> {
  for (let i = 0; i < CAS_RETRY; i++) {
    const got = await coll.doc(_id).get().catch(() => null)
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
 * 下单原子预留：逐条 CAS 扣减。任一不足→**回滚本单已扣**、返回 {ok:false, short}。
 * 不限量条目不扣、不计入 reserved（回补时也不处理）。reserved 写进订单供超时/退款回补。
 */
export async function reserveStock(
  lines: StockLine[]
): Promise<{ ok: boolean; reserved: StockLine[]; short?: StockLine }> {
  const coll = getDb().collection(COLLECTIONS.inventory)
  const reserved: StockLine[] = []
  for (const l of lines) {
    if (!l.productId || !(l.qty > 0)) continue
    const got = await casDecrement(coll, idOf(l.productId, l.spec), l.qty)
    if (got === null) continue // 不限量
    if (got === false) {
      await restoreStock(reserved) // 回滚本单已扣
      return { ok: false, reserved: [], short: l }
    }
    reserved.push({ productId: l.productId, spec: l.spec, qty: l.qty })
  }
  return { ok: true, reserved }
}

/** 回补库存（超时关单 / 退款 / 下单失败回滚）。幂等由调用方绑状态转移保证（只在抢占成功后调一次）。 */
export async function restoreStock(lines: StockLine[]): Promise<void> {
  if (!lines || !lines.length) return
  const coll = getDb().collection(COLLECTIONS.inventory)
  for (const l of lines) {
    if (l && l.productId && l.qty > 0) await casIncrement(coll, idOf(l.productId, l.spec), l.qty)
  }
}

/**
 * 管理端设/调库存（绝对值·上新或补货）。stock=null＝不限量。低库存阈值 threshold 可选。
 *
 * **CAS 防覆盖并发预留（库存#1·外审 R1-R4·P1.8·根因#1）**：绝对写若无条件落库，管理员开着旧页面保存会把
 * 「下单并发预留扣减后的库存」覆盖回旧值 → 超卖窗口。`expectedUpdatedAt` 提供时走条件写——仅当现存文档的
 * 更新时间戳仍等于管理员加载时拿到的值才落库（命中即 updated===1），期间被任何预留/他人改动推进过就判定已变动、
 * 回 {ok:false} 带变动标记让管理端刷新重试。省略/为空＝上新或首设（无文档可覆盖，且预留只动已存在且 stock≠null
 * 的文档·无并发可踩），走原无条件 upsert。
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
    // 条件写（CAS）：仅当库存自管理员加载以来未被并发预留/他人改动才落
    const r = await coll
      .where({ _id, updatedAt: expectedUpdatedAt })
      .update({ data })
      .catch(() => ({ stats: { updated: 0 } }))
    if (r.stats && r.stats.updated === 1) return { ok: true }
    return { ok: false, conflict: true } // 库存已变动 → 管理端刷新重试，不覆盖并发预留
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
 * 组装入成品（进销存 SCM 门4·蓝图 docs/进销存ERP/施工蓝图.md §3·本文件唯一新增出口，车道 C 只调用不直碰）：
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

// 全量扫描上限（深审 P2·根因#7）：裸 .get() 服务端默认 100 条静默截断——SKU 破百后库存页少显示、
// 像没库存记录。改分页循环取齐（100/页），封顶 1000 防无界；到顶如实报 truncated（调用方提示、不装全量）。
export const INVENTORY_SCAN_CAP = 1000

/** 读库存（管理端 S14 列表 / 看板低库存）。productIds 为空＝全量（分页取齐·封顶 INVENTORY_SCAN_CAP）。 */
export async function getInventory(productIds?: string[]): Promise<{ list: any[]; truncated: boolean }> {
  const coll = getDb().collection(COLLECTIONS.inventory)
  const base = productIds && productIds.length ? coll.where({ productId: getDb().command.in(productIds) }) : coll
  const PAGE = 100
  const list: any[] = []
  for (let skip = 0; skip < INVENTORY_SCAN_CAP; skip += PAGE) {
    const r = await base.orderBy('productId', 'asc').skip(skip).limit(PAGE).get().catch(() => ({ data: [] }))
    const rows: any[] = (r && r.data) || []
    list.push(...rows)
    if (rows.length < PAGE) return { list, truncated: false }
  }
  return { list, truncated: true } // 到顶＝可能还有（如实报·守卫 inventory-reads-bounded）
}

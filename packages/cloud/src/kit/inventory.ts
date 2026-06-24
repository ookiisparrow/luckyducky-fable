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

/** 管理端设/调库存（绝对值·上新或补货）。stock=null＝不限量。低库存阈值 threshold 可选。 */
export async function setStock(
  productId: string,
  spec: string,
  stock: number | null,
  threshold?: number
): Promise<void> {
  const coll = getDb().collection(COLLECTIONS.inventory)
  const _id = idOf(productId, spec)
  const data: Record<string, unknown> = { productId, spec, stock, updatedAt: Date.now() }
  if (threshold != null) data.threshold = threshold
  await coll
    .doc(_id)
    .set({ data })
    .catch(async () => {
      await coll.add({ data: { _id, ...data } })
    })
}

/** 读库存（管理端 S14 列表 / 看板低库存）。productIds 为空＝全量（管理端 bounded 调用方限页）。 */
export async function getInventory(productIds?: string[]): Promise<any[]> {
  const coll = getDb().collection(COLLECTIONS.inventory)
  const q = productIds && productIds.length ? coll.where({ productId: getDb().command.in(productIds) }) : coll
  const r = await q.get().catch(() => ({ data: [] }))
  return r.data || []
}

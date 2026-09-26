import { COLLECTIONS, ERR } from '@ldrw/shared'
import { getDb, isDocMissing, isEmptyDoc } from './db'
import { notifyAlert } from './observe'

// 实物库存原子原语（根因#1「下单即预留+乐观 CAS 防超卖」）。
// SKU 库存独立集合 inventory，确定性 _id=`${productId}__${spec}`（与 order.items[].spec 同键，回补一致）。
// 不限量：无文档或 stock=null＝不限量（缺货前不阻断下单·安全迁移）。
// 单一收口：全库仅本文件读写 inventory.stock。

interface StockLine {
  productId: string
  spec: string
  qty: number
}

const CAS_RETRY = 5
// 组合键校验在出生点、不在此消费点：本函数吃存量库存文档的 productId/spec（多来自已保存
// 的历史商品/订单），fail-closed 会拒结算既有数据（钱链反噬）——规则单源见 shared/scmKey.ts 头注，此处历史容忍。
const idOf = (productId: string, spec: string) => `${productId}__${spec || ''}`

// 条件写只认 updated===1 为写成；updated 为 0 或写失败都按「未写成」处理（调用方重读重试或回冲突）。
const casWrite = async (coll: any, where: object, data: object): Promise<boolean> => {
  const r = await coll.where(where).update({ data }).catch(() => ({ stats: { updated: 0 } }))
  return !!r.stats && r.stats.updated === 1
}

// 单条扣减：true=已扣 / false=库存不足（含持续读失败重试耗尽·宁缺勿超卖）/ null=不限量（无档、空档或
// stock=null·不扣不计）。读失败绝不返回 null：调用方 reserveStock 把 null 当「不限量，跳过预留」，读失败落成
// null 就是超卖口子。所以读失败只算一次尝试失败、进下一轮重试；耗尽仍读不到返回 false（与「库存不足」同一
// fail-closed 出口）。
// 读只用来分辨不限量/缺档/不足；扣本身是一次原子条件更新（扣的那一刻库存仍 ≥qty 才扣）——按读到的值比对
// 会把「别人同时也扣了一件」当冲突，热销 SKU 并发时库存明明够也会重试耗尽、误报售罄。
async function casDecrement(coll: any, _id: string, qty: number): Promise<boolean | null> {
  const _ = getDb().command
  let lastRoundReadFailed = false
  for (let i = 0; i < CAS_RETRY; i++) {
    lastRoundReadFailed = false
    let got: any
    try {
      got = await coll.doc(_id).get()
    } catch (e) {
      if (isDocMissing(e)) return null // 无档＝不限量·合法不处理
      lastRoundReadFailed = true
      continue // 读失败（非「无档」）：当一次尝试失败，进入下一轮重试，不静默判不限量
    }
    if (isEmptyDoc(got)) return null // 无档（空 data / 空数组）＝不限量
    const stock = got.data.stock
    if (stock == null) return null // 不限量：合法不处理
    if (stock < qty) return false
    if (await casWrite(coll, { _id, stock: _.gte(qty) }, { stock: _.inc(-qty), updatedAt: Date.now() })) return true
  }
  // 重试耗尽：持续读失败会把本应正常成交的订单误判 OUT_OF_STOCK（fail-closed·不超卖但阻断真实可售订单）——
  // 与「条件写持续落空」（写失败/刚被扣到不足又回补）区分开单独告警，供人工对账/排障。
  // 只看最后一轮：中途读失败过、但最终是条件写持续落空耗尽的，不算「持续读失败」，不告警。
  if (lastRoundReadFailed) await notifyAlert('money', 'reserveStock', 'RESERVE_READ_FAILED', { _id })
  return false // 重试耗尽按不足处理·宁缺勿超卖
}

// 单条递增（回补 / 入成品共用）：true=已加或合法不处理；false=重试耗尽仍未确认写入（调用方须知道：回补丢失 / 入成品争用）。
// 加本身是原子 inc（条件只要求 stock 仍是数字、没被改成不限量），同时有人扣不算冲突。
// 无档：不给 seed＝不限量不处理（回补）；给 seed＝按 qty 建档（入成品时 SKU 可能还没库存档）。
// 读失败（非「无档」）只算一次尝试失败：当成无档会把限量 SKU 误作不限量，所以重试而不折叠。
async function casIncrement(
  coll: any,
  _id: string,
  qty: number,
  seed?: { productId: string; spec: string }
): Promise<boolean> {
  const _ = getDb().command
  for (let i = 0; i < CAS_RETRY; i++) {
    let got: any = null
    try {
      got = await coll.doc(_id).get()
    } catch (e) {
      // 持续读失败下 get 最多放大到 CAS_RETRY 次：只走关单/退款/组装入成品等低频路径，可接受
      if (!isDocMissing(e)) continue
    }
    if (isEmptyDoc(got)) {
      if (!seed) return true // 无档＝不限量·合法不处理
      // 确定性 _id：并发双建时一方撞 DUPLICATE，下一轮走 CAS 累加
      const created = await coll
        .add({ data: { _id, ...seed, stock: qty, updatedAt: Date.now() } })
        .then(() => true, () => false)
      if (created) return true
      continue
    }
    const stock = got.data.stock
    // 不限量：合法不处理（入成品也不把不限量隐式翻成限量，改计量语义须管理员在库存页显式设置）
    if (stock == null) return true
    if (await casWrite(coll, { _id, stock: _.gte(0) }, { stock: _.inc(qty), updatedAt: Date.now() })) return true
  }
  return false
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

/**
 * 回补库存（超时关单/退款/建单失败回滚）。幂等由调用方绑状态转移保证（只在抢占成功后调一次）。
 * fail-soft：任一行回补丢失（casIncrement 重试耗尽）经 kit observe 单出口留痕告警，供人工对账回补；
 * 不因回补丢失让关单/退款失败。
 * 漂移方向仅偏少卖（永不超卖·与防超卖偏置同向）。
 */
export async function restoreStock(lines: StockLine[]): Promise<void> {
  if (!lines || !lines.length) return
  const coll = getDb().collection(COLLECTIONS.inventory)
  const lost: StockLine[] = []
  for (const l of lines) {
    if (l && l.productId && l.qty > 0) {
      const ok = await casIncrement(coll, idOf(l.productId, l.spec), l.qty)
      if (!ok) lost.push(l)
    }
  }
  if (lost.length) await notifyAlert('money', 'restoreStock', ERR.GIVEBACK_LOST, { lines: lost })
}

/**
 * 管理端设/调库存（绝对值）。stock=null＝不限量。
 * 一律按版本戳 updatedAt 条件写（CAS 防覆盖并发预留）：期间被预留/他人改动推进过即回 conflict，
 * 管理端刷新重试、绝不把并发扣减覆盖回旧值（超卖窗口）。expectedUpdatedAt 省略＝按当前档的戳写
 * （只挡读写之间插进来的预留）；无档＝首设建档。版本 0＝老档还没有戳——每次库存写都会盖戳，
 * 「仍没有戳」就等于读到之后没被动过。读失败照抛（不当无档去建档）。
 */
export async function setStock(
  productId: string,
  spec: string,
  stock: number | null,
  threshold?: number,
  expectedUpdatedAt?: number | null
): Promise<{ ok: boolean; conflict?: boolean }> {
  const coll = getDb().collection(COLLECTIONS.inventory)
  const _ = getDb().command
  const _id = idOf(productId, spec)
  const data: Record<string, unknown> = { productId, spec, stock, updatedAt: Date.now() }
  if (threshold != null) data.threshold = threshold
  let version: unknown = expectedUpdatedAt
  if (version == null) {
    const cur = await coll
      .doc(_id)
      .get()
      .then(
        (g: any) => (isEmptyDoc(g) ? null : g.data),
        (e: unknown) => {
          if (isDocMissing(e)) return null
          throw e
        }
      )
    if (!cur) {
      // 建档撞键＝并发方刚建了档：当冲突让管理端刷新
      const created = await coll.add({ data: { _id, ...data } }).then(() => true, () => false)
      return created ? { ok: true } : { ok: false, conflict: true }
    }
    version = cur.updatedAt
  }
  const stamp = version == null || version === 0 ? _.exists(false) : version
  return (await casWrite(coll, { _id, updatedAt: stamp }, data)) ? { ok: true } : { ok: false, conflict: true }
}

/**
 * 组装入成品（进销存 SCM 门4）：CAS 增·无文档则建，stock=null（不限量）保持不动。qty 非正整数 fail-closed。
 */
export async function produceStock(productId: string, spec: string, qty: number): Promise<{ ok: boolean; error?: string }> {
  if (!productId || !Number.isInteger(qty) || qty <= 0) return { ok: false, error: ERR.BAD_QTY }
  const coll = getDb().collection(COLLECTIONS.inventory)
  const ok = await casIncrement(coll, idOf(productId, spec), qty, { productId, spec })
  return ok ? { ok: true } : { ok: false, error: ERR.CONTENTION } // 争用耗尽（管理端低频·几乎不至）
}

// 全量扫描上限：裸 .get() 服务端默认 100 条静默截断——SKU 破百后库存页
// 少显示像没记录。分页取齐（100/页）、封顶防无界；到顶如实报 truncated（调用方提示、不装全量）。
const INVENTORY_SCAN_CAP = 1000

/**
 * 读库存（管理端列表/看板低库存）。productIds 为空＝全量（分页取齐·封顶）。
 * 页查失败直接抛、不当空页（根因#7）：空页会命中 `rows.length < PAGE` 的到底判据，把不完整列表报成
 * truncated:false（看板低库存漏报/库存页少显示）。
 */
export async function getInventory(productIds?: string[]): Promise<{ list: any[]; truncated: boolean }> {
  const coll = getDb().collection(COLLECTIONS.inventory)
  const base = productIds && productIds.length ? coll.where({ productId: getDb().command.in(productIds) }) : coll
  const PAGE = 100
  const list: any[] = []
  for (let skip = 0; skip < INVENTORY_SCAN_CAP; skip += PAGE) {
    // 排序加唯一 tiebreaker _id（根因#7）：productId 非唯一（inventory 一 SKU 一档·_id=productId__spec·
    // 同 productId 多 spec 共键），只按 productId 排序时同值行的相对次序在真 TCB 上无保证——skip 翻页跨页边界
    // 会漏/重同 productId 的 SKU（JS 桩 sort 稳定掩盖此坑）。补 _id 使排序成全序，skip 分页确定不漏不重。
    const r = await base.orderBy('productId', 'asc').orderBy('_id', 'asc').skip(skip).limit(PAGE).get()
    const rows: any[] = (r && r.data) || []
    list.push(...rows)
    if (rows.length < PAGE) return { list, truncated: false }
  }
  return { list, truncated: true }
}

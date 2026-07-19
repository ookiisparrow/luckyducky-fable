import { COLLECTIONS, ERR } from '@ldrw/shared'
import { getDb } from './db'
import { notifyAlert } from './observe'

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
// 组合键校验在出生点、不在此消费点（战役3 批D·D1）：本函数吃存量库存文档的 productId/spec（多来自已保存
// 的历史商品/订单），fail-closed 会拒结算既有数据（钱链反噬）——规则单源见 shared/scmKey.ts 头注，此处历史容忍。
const idOf = (productId: string, spec: string) => `${productId}__${spec || ''}`

// 单条 CAS 扣减：true=已扣 / false=库存不足（含持续读失败重试耗尽·宁缺勿超卖）/ null=不限量（无档·不扣不计）
// P1 修复（批H）：原实现 `.get().catch(() => null)` 把「文档真的不存在」（无档＝合法不限量）与
// 「网络/DB 瞬时读失败」混为一谈，且第一次 get() 失败就立即 return null——调用方 reserveStock 把
// null 解释为「不限量，跳过预留」，真实读失败被静默当成合法不限量放行，直接开超卖口子。
// 改为跟随 casIncrement 已确立的 isDocMissing 判据：只有真无档才判不限量（返回 null）；其它读失败
// 视为一次尝试失败、进入下一轮 CAS_RETRY 重试（不再第一次失败即弃）；重试耗尽仍读不到，返回 false
// （与「库存不足」同一 fail-closed 出口，绝不落回 null——不让读失败伪装成合法不限量）。
//
// 批Q 修复（P3·告警误报）：hadReadFailure 原实现整个重试循环粘滞——只要任意一轮读失败过就
// 一直为 true，即便后续轮次 get() 全部读成功、只是 CAS 更新（where+update）持续被别的并发方
// 抢先而耗尽，也会在重试耗尽时误打 RESERVE_READ_FAILED（把「最后其实是正常并发争抢耗尽」诬成
// 「持续读失败」）。改为每轮开头重置：只保留「决定本轮是否继续/耗尽」那一轮的读失败标记，耗尽后
// 只看最后一轮是否读失败——读失败与纯 CAS 争抢耗尽的告警语义才名副其实。
async function casDecrement(coll: any, _id: string, qty: number): Promise<boolean | null> {
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
    if (!got || !got.data) return null // 防御：正常返回但无数据
    const stock = got.data.stock
    if (stock == null) return null // 不限量：合法不处理
    if (stock < qty) return false
    const r = await coll
      .where({ _id, stock })
      .update({ data: { stock: stock - qty, updatedAt: Date.now() } })
      .catch(() => ({ stats: { updated: 0 } }))
    if (r.stats && r.stats.updated === 1) return true
  }
  // 重试耗尽：持续读失败会把本应正常成交的订单误判 OUT_OF_STOCK（fail-closed·不超卖但阻断真实可售订单）——
  // 与「纯 CAS 并发争抢耗尽」区分开单独告警，供人工对账/排障（后者高并发下属正常现象，不值得告警噪音）。
  // 只看最后一轮：中途读失败过、但最终是被 CAS 更新持续抢先耗尽的，不算「持续读失败」，不告警。
  if (lastRoundReadFailed) await notifyAlert('money', 'reserveStock', 'RESERVE_READ_FAILED', { _id })
  return false // 重试耗尽按不足处理·宁缺勿超卖
}

// 「无档」的判据（真 sdk：doc(id).get() 缺失即 reject）——与其他读失败（网络/瞬时故障）区分开：
// 前者是合法状态（无档=不限量），后者不该被静默吞成合法。
// 复核（bug sweep II 复审）：真 sdk 拒因文案不是固定字面量，实测/社区报错形如
// 「...cannot find document with _id [ID号]...」（errCode -1），与本仓测试桩自造的 'DOCUMENT_NOT_FOUND'
// 不是同一字符串——原判据 `message === 'DOCUMENT_NOT_FOUND'` 只在测试桩下命中，真机会全部落进 else
// 分支被当「读失败」重试 5 次再误报 GIVEBACK_LOST（无档是高频合法态，会把可观测机制拖成告警疲劳）。
// 改为兼容双源：测试桩字面量 精确匹配 + 真 sdk 文案子串匹配，任一命中即判定「无档」。
// 导出仅供测试直打（真 sdk 报错文案没有内存桩可复现，只能对纯函数单测）。
export const isDocMissing = (e: unknown): boolean => {
  const msg = String((e as any)?.message ?? (e as any)?.errMsg ?? '')
  return msg === 'DOCUMENT_NOT_FOUND' || /cannot find document/i.test(msg)
}

// 单条 CAS 回补：true=已扣回/无档或不限量（合法不处理）；false=重试耗尽仍未确认写入（回补丢失，调用方需知道）。
// K3（bug sweep II）：原返回 void 把「读失败」「无档/不限量」「CAS 重试耗尽」三种迥异语义折叠成同一句静默 return——
// restoreStock 的调用方（closeExpiredOrders/orders×3/payCallback/refundCallback）全部 await void，回补丢失
// 永久无信号（方向偏少卖）。改为区分：无档/不限量→true（合法不处理，不算丢失）；读失败→当一次尝试失败继续重试
// （不再与「无档」折叠，防真实读失败被误吞成合法不限量）；重试耗尽→false，交回补丢失信号给调用方。
async function casIncrement(coll: any, _id: string, qty: number): Promise<boolean> {
  for (let i = 0; i < CAS_RETRY; i++) {
    let got: any
    try {
      got = await coll.doc(_id).get()
    } catch (e) {
      if (isDocMissing(e)) return true // 无档＝不限量·合法不处理
      continue // 读失败（非「无档」）：当一次尝试失败，进入下一轮重试——持续性读失败下该行 get 最多放大到
      // CAS_RETRY 次（原实现 1 次即静默放弃）：刻意权衡（评审 P3 要求注明），回补只走关单/退款等低频补偿路径，可接受
    }
    if (!got || !got.data) return true // 防御：正常返回但无数据
    const stock = got.data.stock
    if (stock == null) return true // 不限量：合法不处理
    const r = await coll
      .where({ _id, stock })
      .update({ data: { stock: stock + qty, updatedAt: Date.now() } })
      .catch(() => ({ stats: { updated: 0 } }))
    if (r.stats && r.stats.updated === 1) return true
  }
  return false // 重试耗尽（持续读失败或 CAS 持续被抢）——回补真丢失
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
 * K3（bug sweep II·钱链可观测）：返回语义不变（fail-soft·调用点零改动）——只加信号：任一行回补丢失
 * （casIncrement 重试耗尽）经 kit observe 单出口留痕告警，供人工对账回补；不因回补丢失让关单/退款失败。
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
  if (!productId || !Number.isInteger(qty) || qty <= 0) return { ok: false, error: ERR.BAD_QTY }
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
  return { ok: false, error: ERR.CONTENTION } // 争用耗尽（管理端低频·几乎不至）
}

// 全量扫描上限（黄金 inventory-scm §L）：裸 .get() 服务端默认 100 条静默截断——SKU 破百后库存页
// 少显示像没记录。分页取齐（100/页）、封顶防无界；到顶如实报 truncated（调用方提示、不装全量）。
export const INVENTORY_SCAN_CAP = 1000

/**
 * 读库存（管理端列表/看板低库存）。productIds 为空＝全量（分页取齐·封顶）。
 * 页查失败 fail-loud（P1·根因#7 修复）：单页 .get() 失败必须与「真扫到底」可区分——原先 `.catch(()=>[])`
 * 把失败页当空页处理，命中 `rows.length < PAGE` 的到底判据，静默返回不完整列表且 truncated:false（Dashboard
 * 低库存待办漏报/库存页少显示）。改为不吞：失败直接抛出，交给唯一调用方 adminApi listInventory 的域出口
 * 统一 try/catch 兜底 500（域内既定惯例·不再局部加一层重复保护，见 §7 防过度工程）。
 */
export async function getInventory(productIds?: string[]): Promise<{ list: any[]; truncated: boolean }> {
  const coll = getDb().collection(COLLECTIONS.inventory)
  const base = productIds && productIds.length ? coll.where({ productId: getDb().command.in(productIds) }) : coll
  const PAGE = 100
  const list: any[] = []
  for (let skip = 0; skip < INVENTORY_SCAN_CAP; skip += PAGE) {
    // 排序加唯一 tiebreaker _id（深审 P2·根因#7）：productId 非唯一（inventory 一 SKU 一档·_id=productId__spec·
    // 同 productId 多 spec 共键），只按 productId 排序时同值行的相对次序在真 TCB 上无保证——skip 翻页跨页边界
    // 会漏/重同 productId 的 SKU（JS 桩 sort 稳定掩盖此坑）。补 _id 使排序成全序，skip 分页确定不漏不重。
    const r = await base.orderBy('productId', 'asc').orderBy('_id', 'asc').skip(skip).limit(PAGE).get()
    const rows: any[] = (r && r.data) || []
    list.push(...rows)
    if (rows.length < PAGE) return { list, truncated: false }
  }
  return { list, truncated: true }
}

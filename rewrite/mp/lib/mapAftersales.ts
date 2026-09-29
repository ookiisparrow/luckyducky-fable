// 售后映射（纯函数）：
// 状态中文化/金额两位小数/可申请行计算（refundable 且剩余可退件>0 且未申请过——与云端 applyRefund 同口径，
// 前端只做入口收窄，最终裁决在云端）/翻页追加去重（申请成功后列表即时收窄由 applicableLines 排除已申请实现）。
import { dateTime, money } from './mapOrders'
import type { OrderLineVM } from './mapOrders'

export interface AfterSaleVM {
  id: string
  orderId: string
  lineId: string
  name: string
  spec: string
  qty: number
  refundAmountLabel: string
  status: string
  statusLabel: string
  appliedAtLabel: string
  reason: string
  rejectReason: string // 已拒绝时运营写的拒绝理由（adminApi refunds 落 rejectReason·旧单无则空串）
  canWithdraw: boolean // 顾客可撤回：申请中且没被商家批过（批过又回滚的单云端也拒·withdrawRefund 同口径）
}

// 状态中文·客户向措辞。canonical 单源在 rewrite/shared/src/statusLabels.ts 的 AFTERSALE_STATUS_LABEL_CUSTOMER
// ——mp 包进不了 @ldrw/shared（同 mapOrders.ts 头注），故手落此副本；措辞与 admin 运营向（同源
// AFTERSALE_STATUS_LABEL_OPS，见 admin/src/lib/format.ts）刻意不同（客户视角安抚语气 vs 商家视角简洁流程词），
// 不是漂移；状态码集合须与 shared 一致，由守卫 rw-mp-copies-synced 焊死。
const STATUS_LABELS: Record<string, string> = {
  applied: '申请中',
  approved: '已同意 · 退款处理中',
  refunded: '已退款',
  rejected: '已拒绝',
  withdrawn: '已撤回',
}
export const asStatusLabel = (s: unknown): string => STATUS_LABELS[String(s)] || String(s || '')

/** 售后单 → VM；无标识裸脏档回 null（整行剔除不白屏）。 */
export function mapAfterSale(raw: unknown): AfterSaleVM | null {
  const a = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>
  const id = String(a._id || '')
  const orderId = String(a.orderId || '')
  if (!id || !orderId) return null
  return {
    id,
    orderId,
    lineId: String(a.lineId || a.productId || ''),
    name: String(a.name || ''),
    spec: String(a.spec || ''),
    qty: Number.isInteger(a.qty) && a.qty > 0 ? a.qty : 0,
    refundAmountLabel: money(a.refundAmount) || '¥0.00',
    status: String(a.status || ''),
    statusLabel: asStatusLabel(a.status),
    appliedAtLabel: dateTime(a.appliedAt),
    reason: String(a.reason || ''),
    rejectReason: String(a.rejectReason || ''),
    canWithdraw: a.status === 'applied' && !a.approvedAt,
  }
}

export function mapAfterSales(list: unknown): AfterSaleVM[] {
  if (!Array.isArray(list)) return []
  return list.map(mapAfterSale).filter((x): x is AfterSaleVM => !!x)
}

/** 翻页合并：追加去重（同 id 不重复）；失败调用方不调本函数即天然不覆盖已有。 */
export function mergeAfterSales(existing: AfterSaleVM[], incoming: AfterSaleVM[]): AfterSaleVM[] {
  const seen = new Set(existing.map((a) => a.id))
  return [...existing, ...incoming.filter((a) => !seen.has(a.id))]
}

/** 本单「申请过」的行：顾客撤回（withdrawn）的不算，可重新申请（云端 applyRefund 同口径）。 */
export function appliedLineIdsOf(list: AfterSaleVM[], orderId: string): string[] {
  return list.filter((a) => a.orderId === orderId && a.status !== 'withdrawn').map((a) => a.lineId)
}

/** 本单可撤回的行 lineId→true（订单详情行内撤回键）。 */
export function withdrawableLines(list: AfterSaleVM[], orderId: string): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const a of list) if (a.orderId === orderId && a.canWithdraw) out[a.lineId] = true
  return out
}

// 撤回失败（云端 withdrawRefund 回 BAD_STATUS:<此刻状态>，前缀同 payFlow.ts 手抄口径）→ 人话
const WITHDRAW_ERR: Record<string, string> = {
  'BAD_STATUS:approved': '商家已同意退款，正在处理，不能撤回了',
  'BAD_STATUS:refunded': '这条已经退款了，不能撤回',
  'BAD_STATUS:rejected': '这条申请已被拒绝，不用撤回',
  'BAD_STATUS:withdrawn': '这条申请已经撤回了',
}
export const withdrawErrText = (e: unknown): string => WITHDRAW_ERR[String(e || '')] || '撤回没成功，稍后再试'

/** 可申请行（与云端 applyRefund 同口径的入口收窄）：订单态 ∈ 已付/已发/完成 且 行 refundable
 *  且剩余可退件（qty−enteredQty）>0 且该行未申请过。旧单无 enteredQty 视 0＝整行可退。 */
export function applicableLines(orderStatus: string, items: OrderLineVM[], appliedLineIds: string[]): OrderLineVM[] {
  if (!['paid', 'shipped', 'done'].includes(orderStatus)) return []
  const applied = new Set(appliedLineIds)
  return items.filter((it) => it.refundable && it.qty - it.enteredQty > 0 && !applied.has(it.lineId))
}

/** 本单被拒的行（被拒维持永久锁、不能再申请·老板 2026-09-29 拍板 5·云端 applyRefund 同口径）。 */
export function rejectedLineIdsOf(list: AfterSaleVM[], orderId: string): string[] {
  return list.filter((a) => a.orderId === orderId && a.status === 'rejected').map((a) => a.lineId)
}
export const REFUND_REJECTED = '已被拒绝，有疑问联系客服'

/** 「退款」段置灰原因（售后半屏）：还有可退行回空串；否则按不可退的来由说人话——
 *  每行都被拒＝已被拒绝（引导联系客服），不可退/剩余可退件为 0＝已开课（进课即失效退货权·云端 learning 同口径），
 *  已申请过＝这件已申请过，两种都有给合并句。 */
export function refundBlock(orderStatus: string, items: OrderLineVM[], appliedLineIds: string[], rejectedLineIds: string[] = []): string {
  if (applicableLines(orderStatus, items, appliedLineIds).length) return ''
  if (items.length && items.every((it) => rejectedLineIds.includes(it.lineId))) return REFUND_REJECTED
  const applied = new Set(appliedLineIds)
  const started = items.some((it) => !applied.has(it.lineId) && (!it.refundable || it.qty - it.enteredQty <= 0))
  const hasApplied = items.some((it) => applied.has(it.lineId))
  if (started && hasApplied) return '已开课或已申请过的商品不能再退款'
  if (hasApplied) return '这件已申请过'
  return '已开课的商品不支持退款'
}

// —— 订单叠加售后显示（只改显示，不改订单状态/钱）——
// 云端退款不改订单状态（applyRefund 只新建售后单，订单仍是 paid/shipped/done），只看订单状态会出现
// 「申请了退款还显示正在发货」。页面另拉本人售后，按订单汇总后叠加到状态名/灯/行标上。
// ponytail: 页面只取最近 100 条售后，更早的不叠加；升级路径＝云端订单接口直接带售后汇总。
export interface OrderAfterSales {
  live: '' | 'applied' | 'approved' // 进行中售后（两者都有取 approved）
  lines: Record<string, '退款中' | '已退款'> // 行标（rejected 不标）
}

/** 按订单汇总售后：出现在结果里＝该单有售后记录（含被拒/已撤回，这两种不叠加也不标行）。一行只有一张售后单（云端确定性 _id），无冲突。 */
export function afterSalesByOrder(list: AfterSaleVM[]): Record<string, OrderAfterSales> {
  const out: Record<string, OrderAfterSales> = {}
  for (const a of list) {
    const o = out[a.orderId] || (out[a.orderId] = { live: '', lines: {} })
    if (a.status === 'applied' || a.status === 'approved') {
      if (o.live !== 'approved') o.live = a.status
      o.lines[a.lineId] = '退款中'
    } else if (a.status === 'refunded') o.lines[a.lineId] = '已退款'
  }
  return out
}

export interface AfterSaleOverlay {
  head: string // 状态名
  sub: string // 列表右侧短句
  detail: string // 详情说明句（完整一句·灰字）
  led: { tone: string; halo: string } // 状态灯：售后中墨点、已退款灰圈（UI 审查 15 问 6a·2026-09-30）
  color: string // 状态名字色：一律墨（空）——颜色只落在灯上
}

/** 叠加规则：有进行中售后→「售后中」墨点；否则每一行都已退款→「已退款」灰圈（终态·不用「成功」色）；否则不叠加（null）。
 *  不写审核/到账时效（老板 2026-09-30）。
 *  「已退款」按行判断：云端一行只退剩余可退件（qty−已进课件），已进课的件退不了，那行有 refunded 就算退完。 */
export function afterSaleOverlay(items: OrderLineVM[], s: OrderAfterSales | undefined): AfterSaleOverlay | null {
  if (!s) return null
  if (s.live) {
    const ok = s.live === 'approved'
    return {
      head: '售后中',
      sub: ok ? '退款处理中' : '退款申请中',
      detail: ok ? '退款处理中，完成后原路退回' : '退款申请已提交，审核后原路退回', // 黑体（详情说明句·.t-sys）
      led: { tone: 'var(--v5-ink)', halo: '' },
      color: '',
    }
  }
  if (items.length && items.every((it) => s.lines[it.lineId] === '已退款')) {
    return {
      head: '已退款',
      sub: '已原路退回', // 黑体（列表右侧短句·.t-sys）
      detail: '已原路退回', // 黑体（详情说明句·.t-sys）
      led: { tone: 'rgba(17,17,17,.28)', halo: 'none' },
      color: '',
    }
  }
  return null
}

// 售后映射（纯函数·黄金 orders-money 售后节前端半边 + frontend-store §八）（守卫 rw-mp-aftersales-golden）：
// 状态中文化/金额两位小数/可申请行计算（refundable 且剩余可退件>0 且未申请过——与云端 applyRefund 同口径，
// 前端只做入口收窄，最终裁决在云端）/翻页追加去重/申请成功插头部。
import { dateTime } from './mapOrders'
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
}

const STATUS_LABELS: Record<string, string> = {
  applied: '申请中',
  approved: '已同意 · 退款处理中',
  refunded: '已退款',
  rejected: '已拒绝',
}
export const asStatusLabel = (s: unknown): string => STATUS_LABELS[String(s)] || String(s || '')

const money = (v: unknown): string => {
  const n = Number(v)
  return Number.isFinite(n) ? '¥' + n.toFixed(2) : ''
}

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
  }
}

export function mapAfterSales(list: unknown): AfterSaleVM[] {
  if (!Array.isArray(list)) return []
  return list.map(mapAfterSale).filter((x): x is AfterSaleVM => !!x)
}

/** 翻页合并（黄金 §八）：追加去重（同 id 不重复）；失败调用方不调本函数即天然不覆盖已有。 */
export function mergeAfterSales(existing: AfterSaleVM[], incoming: AfterSaleVM[]): AfterSaleVM[] {
  const seen = new Set(existing.map((a) => a.id))
  return [...existing, ...incoming.filter((a) => !seen.has(a.id))]
}

/** 申请成功插头部（可申请列表即时消失该条目由 applicableLines 排除已申请实现）。 */
export function prependAfterSale(list: AfterSaleVM[], rec: unknown): AfterSaleVM[] {
  const vm = mapAfterSale(rec)
  return vm ? [vm, ...list.filter((a) => a.id !== vm.id)] : list
}

/** 可申请行（与云端 applyRefund 同口径的入口收窄）：订单态 ∈ 已付/已发/完成 且 行 refundable
 *  且剩余可退件（qty−enteredQty）>0 且该行未申请过。旧单无 enteredQty 视 0＝整行可退。 */
export function applicableLines(orderStatus: string, items: OrderLineVM[], appliedLineIds: string[]): OrderLineVM[] {
  if (!['paid', 'shipped', 'done'].includes(orderStatus)) return []
  const applied = new Set(appliedLineIds)
  return items.filter((it) => it.refundable && it.qty - it.enteredQty > 0 && !applied.has(it.lineId))
}

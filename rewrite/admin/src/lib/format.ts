// 展示格式化（金额恒两位小数/状态中文/时间——与 mp 同口径·后台侧小副本，语义由测试钉）。
export const yuan = (v: unknown): string => {
  const n = Number(v)
  return Number.isFinite(n) ? '¥' + n.toFixed(2) : ''
}

const ORDER_LABELS: Record<string, string> = {
  pending: '待支付',
  paid: '待发货',
  shipped: '已发货',
  done: '已完成',
  closed: '已关闭',
  refund_required: '退款处理中',
}
export const orderStatusLabel = (s: unknown): string => ORDER_LABELS[String(s)] || String(s || '')

const REFUND_LABELS: Record<string, string> = {
  applied: '待审核',
  approved: '退款处理中',
  refunded: '已退款',
  rejected: '已拒绝',
}
export const refundStatusLabel = (s: unknown): string => REFUND_LABELS[String(s)] || String(s || '')

export function dateTime(ts: unknown): string {
  const n = Number(ts)
  if (!Number.isFinite(n) || n <= 0) return ''
  const d = new Date(n)
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

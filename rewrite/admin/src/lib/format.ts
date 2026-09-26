// 展示格式化（金额恒两位小数/状态中文/时间——与 mp 同口径·后台侧小副本，语义由测试钉）。
// 订单/售后状态标签从 @ldrw/shared 的 Record<OrderStatus/AfterSaleStatus,string> 取运营向标签（不手抄），
// 状态机新增状态没配标签会编译期报错（见 shared/src/statusLabels.ts 头注）。
import { ORDER_STATUS_LABEL_OPS, AFTERSALE_STATUS_LABEL_OPS } from '@ldrw/shared'

export const yuan = (v: unknown): string => {
  const n = Number(v)
  return Number.isFinite(n) ? '¥' + n.toFixed(2) : ''
}

export const orderStatusLabel = (s: unknown): string =>
  (ORDER_STATUS_LABEL_OPS as Record<string, string>)[String(s)] || String(s || '')

export const refundStatusLabel = (s: unknown): string =>
  (AFTERSALE_STATUS_LABEL_OPS as Record<string, string>)[String(s)] || String(s || '')

export function dateTime(ts: unknown): string {
  const n = Number(ts)
  if (!Number.isFinite(n) || n <= 0) return ''
  const d = new Date(n)
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

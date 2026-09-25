// 订单与钱组 api（薄封装·全部经 client.post 带会话令牌）
// 回包类型取 @ldrw/shared 的后台契约（键与单位真源 tests/contracts/admin-money.json）
import type {
  AdminDashboard,
  AdminOrdersPage,
  AdminStatusCounts,
  AdminOrderDetail,
  AdminShipped,
  AdminShipBatch,
  AdminRefundsPage,
  AdminRefundDetail,
  AdminOverrideRefund,
} from '@ldrw/shared'
import { client } from './index'
import type { TypedResult } from './client'

// 回包是 JSON、运行时不校验：只在这一处把它当契约类型看，真实性靠上面那份契约的两头测试锁
const post = <T extends object>(action: string, data?: Record<string, unknown>) => client.post(action, data) as Promise<TypedResult<T>>

export const getDashboard = () => post<AdminDashboard>('getDashboard')
// q=单号精确搜索（服务端·跨全部状态·不受当前页/标签限制·根因#7）；有 q 时后端忽略 status。
export const listOrders = (status?: string, cursor?: unknown, limit = 20, q?: string) =>
  post<AdminOrdersPage>('listOrders', { status: status || undefined, cursor, limit, q: q || undefined })
export const orderCounts = () => post<AdminStatusCounts>('orderCounts')
export const getOrderDetail = (id: string) => post<AdminOrderDetail>('getOrderDetail', { id }) // 逐商品激活态（VMlhp·抽屉异步补）
// ackRefundedQty＝发货人看到的每行已退件数（行键→件数）：首次发货时 shipOne 与现状逐行比，对不上回 REFUND_LINES_CHANGED
export const shipOrder = (id: string, company: string, trackingNo: string, ackRefundedQty: Record<string, number>) =>
  post<AdminShipped>('shipOrder', { id, company, trackingNo, ackRefundedQty })
// 批量发货（P1·上量瓶颈）：items=[{id,trackingNo,company?,ackRefundedQty}]，company=整批共用快递公司；逐单独立·一单失败不拖累其余。
export const shipOrders = (items: Array<{ id: string; trackingNo: string; company?: string; ackRefundedQty: Record<string, number> }>, company: string) =>
  post<AdminShipBatch>('shipOrders', { items, company })
export const clearFeeMismatch = (id: string) => post<object>('clearFeeMismatch', { id })
// q=订单号精确搜索（服务端·跨全部状态·根因#7）；有 q 时后端忽略 status
export const listRefunds = (status?: string, cursor?: unknown, limit = 20, q?: string) =>
  post<AdminRefundsPage>('listRefunds', { status: status || undefined, cursor, limit, q: q || undefined })
export const refundCounts = () => post<AdminStatusCounts>('refundCounts')
export const getRefundDetail = (id: string) => post<AdminRefundDetail>('getRefundDetail', { id })
export const approveRefund = (id: string) => post<object>('approveRefund', { id })
export const rejectRefund = (id: string, reason: string) => post<object>('rejectRefund', { id, reason })
// 越规退款（决策§26·cap refund:manage）：金额/退货资格一律云端裁决（钱链后端零改动），前端只传订单/行/原因
export const overrideRefund = (orderId: string, lineId: string, reason: string) => post<AdminOverrideRefund>('overrideRefund', { orderId, lineId, reason })
// 补录实际到账金额（支付异常单退款死胡同出口·cap refund:manage）：paidFeeFen=整数分，管理员核对流水后填写
export const recordPaidFee = (id: string, paidFeeFen: number) => post<object>('recordPaidFee', { id, paidFeeFen })

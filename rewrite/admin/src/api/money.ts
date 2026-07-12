// 订单与钱组 api（薄封装·全部经 client.post 带会话令牌）
import { client } from './index'

export const getDashboard = () => client.post('getDashboard')
// q=单号精确搜索（服务端·跨全部状态·不受当前页/标签限制·根因#7）；有 q 时后端忽略 status。
export const listOrders = (status?: string, cursor?: unknown, limit = 20, q?: string) =>
  client.post('listOrders', { status: status || undefined, cursor, limit, q: q || undefined })
export const orderCounts = () => client.post('orderCounts')
export const getOrderDetail = (id: string) => client.post('getOrderDetail', { id }) // 逐商品激活态（VMlhp·抽屉异步补）
export const shipOrder = (id: string, company: string, trackingNo: string) => client.post('shipOrder', { id, company, trackingNo })
// 批量发货（P1·上量瓶颈）：items=[{id,trackingNo,company?}]，company=整批共用快递公司；逐单独立·一单失败不拖累其余。
export const shipOrders = (items: Array<{ id: string; trackingNo: string; company?: string }>, company: string) =>
  client.post('shipOrders', { items, company })
export const clearFeeMismatch = (id: string) => client.post('clearFeeMismatch', { id })
// q=订单号精确搜索（服务端·跨全部状态·根因#7）；有 q 时后端忽略 status
export const listRefunds = (status?: string, cursor?: unknown, limit = 20, q?: string) =>
  client.post('listRefunds', { status: status || undefined, cursor, limit, q: q || undefined })
export const refundCounts = () => client.post('refundCounts')
export const getRefundDetail = (id: string) => client.post('getRefundDetail', { id })
export const approveRefund = (id: string) => client.post('approveRefund', { id })
export const rejectRefund = (id: string, reason: string) => client.post('rejectRefund', { id, reason })
// 越规退款（决策§26·cap refund:manage）：金额/退货资格一律云端裁决（钱链后端零改动），前端只传订单/行/原因
export const overrideRefund = (orderId: string, lineId: string, reason: string) => client.post('overrideRefund', { orderId, lineId, reason })

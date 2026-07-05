// 订单与钱组 api（薄封装·全部经 client.post 带会话令牌）
import { client } from './index'

export const getDashboard = () => client.post('getDashboard')
export const listOrders = (status?: string, cursor?: unknown, limit = 20) => client.post('listOrders', { status: status || undefined, cursor, limit })
export const orderCounts = () => client.post('orderCounts')
export const shipOrder = (id: string, company: string, trackingNo: string) => client.post('shipOrder', { id, company, trackingNo })
export const clearFeeMismatch = (id: string) => client.post('clearFeeMismatch', { id })
export const listRefunds = (status?: string, cursor?: unknown, limit = 20) => client.post('listRefunds', { status: status || undefined, cursor, limit })
export const refundCounts = () => client.post('refundCounts')
export const getRefundDetail = (id: string) => client.post('getRefundDetail', { id })
export const approveRefund = (id: string) => client.post('approveRefund', { id })
export const rejectRefund = (id: string, reason: string) => client.post('rejectRefund', { id, reason })

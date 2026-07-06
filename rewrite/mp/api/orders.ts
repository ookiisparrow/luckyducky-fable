// 订单域 api（经 app 网关·价格数量一律云端校验，前端只传 id/sku/qty 与地址快照）
import { callApp, type ApiResult } from '../utils/cloud'

export interface OrderLine {
  id: string
  sku?: string
  qty: number
}

export const createOrder = (items: OrderLine[], address: { name: string; phone: string; region: string; detail: string }): Promise<ApiResult> =>
  callApp('createOrder', { items, address })

export const pay = (id: string): Promise<ApiResult> => callApp('pay', { id })

export const getMyOrders = (cursor?: unknown, limit = 20, status = ''): Promise<ApiResult> => callApp('getMyOrders', { cursor, limit, status })
export const getOrderById = (id: string): Promise<ApiResult> => callApp('getOrderById', { id })
export const confirmReceive = (id: string): Promise<ApiResult> => callApp('confirmReceive', { id })

export const applyRefund = (orderId: string, lineId: string, reason: string): Promise<ApiResult> => callApp('applyRefund', { orderId, lineId, reason })
export const getMyAfterSales = (cursor?: unknown, limit = 20): Promise<ApiResult> => callApp('getMyAfterSales', { cursor, limit })

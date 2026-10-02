// 订单域 api（经 app 网关·价格数量一律云端校验，前端只传 id/sku/qty 与地址快照）
import { callApp, type ApiResult } from '../utils/cloud'
import { markStale } from '../utils/fresh'

// 写完标脏（utils/fresh），订单列表/「我」页回来必重拉。失败也标：超时时云端可能已成功
const touch = (p: Promise<ApiResult>): Promise<ApiResult> =>
  p.then((r) => {
    markStale('orders')
    return r
  })

export interface OrderLine {
  id: string
  sku?: string
  qty: number
}

// idempotencyKey：同一份结算草稿的重试复用同一个键（lib/checkout.ts getIdemKey），云端据此不建二单
export const createOrder = (
  items: OrderLine[],
  address: { name: string; phone: string; region: string; detail: string },
  idempotencyKey?: string
): Promise<ApiResult> => touch(callApp('createOrder', { items, address, idempotencyKey }))

export const pay = (id: string): Promise<ApiResult> => touch(callApp('pay', { id }))

// withAfterSales：一次往返顺带本人最近 100 条售后（回包多 afterSales 键，读失败则不带）
export const getMyOrders = (cursor?: unknown, limit = 20, status = '', withAfterSales = false): Promise<ApiResult> =>
  callApp('getMyOrders', withAfterSales ? { cursor, limit, status, withAfterSales: true } : { cursor, limit, status })
// 回 { counts: { pending, paid, shipped } }，某一态数失败给 null
export const countMyOrders = (): Promise<ApiResult> => callApp('countMyOrders')
export const getOrderById = (id: string): Promise<ApiResult> => callApp('getOrderById', { id })
export const confirmReceive = (id: string): Promise<ApiResult> => touch(callApp('confirmReceive', { id }))
export const cancelOrder = (id: string): Promise<ApiResult> => touch(callApp('cancelOrder', { id }))

export const applyRefund = (orderId: string, lineId: string, reason: string): Promise<ApiResult> => touch(callApp('applyRefund', { orderId, lineId, reason }))
// 退款试算（只读，与 applyRefund 同一份云端算额）：回 { refundFen }
export const estimateRefund = (orderId: string, lineId: string): Promise<ApiResult> => callApp('estimateRefund', { orderId, lineId })
// 撤回申请中的售后；状态不对时回 BAD_STATUS:<此刻状态>
export const withdrawRefund = (orderId: string, lineId: string): Promise<ApiResult> => touch(callApp('withdrawRefund', { orderId, lineId }))
// orderId：只要这一单的售后。旧版云端不认这个参数会回最近 limit 条，页面本就按单号筛，结果照样对
export const getMyAfterSales = (cursor?: unknown, limit = 20, orderId?: string): Promise<ApiResult> =>
  callApp('getMyAfterSales', orderId ? { cursor, limit, orderId } : { cursor, limit })

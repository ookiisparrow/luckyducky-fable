// 订单域 api（经 app 网关·价格数量一律云端校验，前端只传 id/sku/qty 与地址快照）
import { callApp, type ApiResult } from '../utils/cloud'
import { markStale } from '../utils/fresh'

// 写完标脏（utils/fresh）：订单列表/「我」页回来必重拉。超时等失败也标——云端可能已成功（写路径都幂等）
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

// idempotencyKey：结算草稿创建时生成一次、重试复用同一个键（见 lib/checkout.ts getIdemKey）——
// 云端据此把网络超时后的重复提交折叠成同一笔订单，不重复扣库存/建二单。
export const createOrder = (
  items: OrderLine[],
  address: { name: string; phone: string; region: string; detail: string },
  idempotencyKey?: string
): Promise<ApiResult> => touch(callApp('createOrder', { items, address, idempotencyKey }))

export const pay = (id: string): Promise<ApiResult> => touch(callApp('pay', { id }))

// withAfterSales（性能批 #3）：一次往返顺带本人最近 100 条售后（回包多 afterSales 键·读失败不带键）；订单列表用，别处照旧
export const getMyOrders = (cursor?: unknown, limit = 20, status = '', withAfterSales = false): Promise<ApiResult> =>
  callApp('getMyOrders', withAfterSales ? { cursor, limit, status, withAfterSales: true } : { cursor, limit, status })
// 「我」页订单格数字（性能批 #1）：三态精确数一次往返·回 { counts: { pending, paid, shipped } }，单态失败给 null
export const countMyOrders = (): Promise<ApiResult> => callApp('countMyOrders')
export const getOrderById = (id: string): Promise<ApiResult> => callApp('getOrderById', { id })
export const confirmReceive = (id: string): Promise<ApiResult> => touch(callApp('confirmReceive', { id }))
export const cancelOrder = (id: string): Promise<ApiResult> => touch(callApp('cancelOrder', { id }))

export const applyRefund = (orderId: string, lineId: string, reason: string): Promise<ApiResult> => touch(callApp('applyRefund', { orderId, lineId, reason }))
// 退款试算（只读·与 applyRefund 同一份云端算额）：回 { refundFen }（分整数），前端只做展示
export const estimateRefund = (orderId: string, lineId: string): Promise<ApiResult> => callApp('estimateRefund', { orderId, lineId })
// 撤回申请中的售后（仅本人·仅申请中，最终裁决在云端；失败回 BAD_STATUS:<此刻状态>）
export const withdrawRefund = (orderId: string, lineId: string): Promise<ApiResult> => touch(callApp('withdrawRefund', { orderId, lineId }))
export const getMyAfterSales = (cursor?: unknown, limit = 20): Promise<ApiResult> => callApp('getMyAfterSales', { cursor, limit })

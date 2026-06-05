/**
 * 电商 ERP 对接接口（预留空壳）。
 * 库存、订单同步、发货等与 ERP 系统的交互放这里。
 */
import { request } from './request'

export function syncOrder(order) {
  return request({ url: '/erp/order', method: 'POST', data: order }) // TODO
}

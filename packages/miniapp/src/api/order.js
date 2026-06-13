/**
 * 订单接口。订单是敏感业务：一律走云函数（createOrder 云端定价，不信任前端价）。
 * 页面不直接调这里，统一经 store/orders.js 收口。
 *
 * T1 砍多端：原 H5/App 本地回退（localCreateOrder 镜像）已删——api 只对接云。
 * 交易类（下单/确认收货）无云即上抛、绝不本地伪成功（根因账本 #6）；读类返回空。
 */
import { callCloud } from '@/utils/cloud.js'
import { logger } from '@/utils/logger.js'

// 下单（云端定价）：云拒单/异常一律上抛由页面提示，不本地伪成功。
export async function createOrder(payload) {
  const res = await callCloud('createOrder', payload)
  if (res?.ok && res.order) return res.order
  throw new Error(res?.error || 'CREATE_ORDER_FAILED')
}

// 发起微信支付（仅小程序端有真实链路）：云函数 pay 校验本人 pending 单并按库内金额
// 下单 → 拉起微信收银台。错误语义：PAY_CANCELLED=用户取消；ORDER_CLOSED=已超时关单；
// PAY_NOT_ENABLED=支付通道未启用。0 元单云端直接置 paid 不拉收银台。
export async function payOrder(id) {
  const res = await callCloud('pay', { id })
  if (!res) throw new Error('PAY_UNAVAILABLE') // 非小程序端无云调用，调用方界面不应暴露入口
  if (!res.ok) throw new Error(res.error || 'PAY_FAILED')
  if (res.paid) return { paid: true } // 0 元单：云端已直接置 paid
  await new Promise((resolve, reject) => {
    uni.requestPayment({
      provider: 'wxpay',
      ...res.payment,
      success: resolve,
      fail: (e) => {
        const cancelled = e && e.errMsg && e.errMsg.includes('cancel')
        reject(new Error(cancelled ? 'PAY_CANCELLED' : 'PAY_FAILED'))
      },
    })
  })
  return { paid: true }
}

// 确认收货：云端流转 shipped → done（仅本人订单）；失败上抛。
export async function confirmReceive(id) {
  const res = await callCloud('confirmReceive', { id })
  if (res?.ok) return { doneAt: res.doneAt }
  throw new Error(res?.error || 'CONFIRM_FAILED')
}

// 按单号取本人订单（详情兜底：列表 limit 之外的老单也能打开）；无/未找到返回 null。
export async function getOrderById(id) {
  try {
    const res = await callCloud('getOrderById', { id })
    if (res?.ok && res.order) return res.order
  } catch (e) {
    logger.warn('order', 'getOrderById 云端失败', e)
  }
  return null
}

// 游标分页（根因#7）：cursor 传上一页 nextCursor 取下一页；返回 { list, nextCursor, hasMore }。
export async function getMyOrders(cursor) {
  try {
    const res = await callCloud('getMyOrders', cursor != null ? { cursor } : {})
    if (res?.ok && Array.isArray(res.list)) {
      return { list: res.list, nextCursor: res.nextCursor ?? null, hasMore: !!res.hasMore }
    }
  } catch (e) {
    logger.warn('order', 'getMyOrders 云端失败，回退空列表', e)
  }
  return { list: [], nextCursor: null, hasMore: false }
}

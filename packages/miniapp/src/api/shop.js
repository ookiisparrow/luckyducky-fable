/**
 * 商城相关接口。
 *
 * getProducts：走云函数 getProducts，返回 canonical 形状
 *   [{ id, name, tag, price, was, featured, sort }]——价为数字，展示层拼 ￥。
 *   页面不直接调这里，统一经 store/products.js 收口。
 *
 * T1 砍多端：原 H5/App 本地回退（localProducts）已删；无云/失败返回空列表，由 store 走空态。
 */
import { callCloud } from '@/utils/cloud.js'
import { logger } from '@/utils/logger.js'

export async function getProducts() {
  try {
    const res = await callCloud('getProducts')
    if (Array.isArray(res?.list)) return res.list
  } catch (e) {
    logger.warn('shop', 'getProducts 云端失败', e)
  }
  return []
}

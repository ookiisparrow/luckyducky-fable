/**
 * 商城相关接口。
 *
 * getProducts：小程序端走云函数 getProducts；H5 / App 端回退本地 data/catalog。
 *   返回 canonical 形状 [{ id, name, tag, price, was, featured, sort }]——价为数字，展示层拼 ￥。
 *   页面不直接调这里，统一经 store/products.js 收口。
 */
import { request } from './request'
import { callCloud } from '@/utils/cloud.js'
import { CATALOG, FEATURED_IDS } from '@/data/catalog.js'
import { logger } from '@/utils/logger.js'

// H5 / App 端本地回退：把 catalog 拼成与云端同形状（补 featured / sort）。
function localProducts() {
  return Object.values(CATALOG).map((p, i) => ({
    ...p,
    featured: FEATURED_IDS.includes(p.id),
    sort: i,
  }))
}

export async function getProducts() {
  try {
    const res = await callCloud('getProducts')
    const list = res?.list
    if (Array.isArray(list) && list.length) return list
  } catch (e) {
    logger.warn('shop', 'getProducts 云端失败，回退本地', e)
  }
  return localProducts()
}

export function getReviews() {
  return request({ url: '/reviews' }) // TODO（评价上云在后续阶段）
}

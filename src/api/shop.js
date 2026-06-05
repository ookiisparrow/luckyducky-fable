/**
 * 商城相关接口（预留空壳）。
 * 现在首页内容来自 src/data/*.js；以后把这里实现起来、
 * 在页面里改成「调用 shop.js」即可，界面无需改动。
 */
import { request } from './request'

// eslint 友好：参数先留着，接后端时启用
export function getProducts() {
  // return request({ url: '/products' })
  return request({ url: '/products' }) // TODO
}

export function getReviews() {
  return request({ url: '/reviews' }) // TODO
}

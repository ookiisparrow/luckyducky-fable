/**
 * 商品总表（单一来源，按 id）。
 * 「活的」商品入口——首页横滑 / 购物车推荐 / 详情推荐 / 详情头部——都从这里按 id 取，
 * 改一处全店一致。价格用数字（canonical），各处展示时自行拼 ￥。
 *
 * 订单/售后里的商品是「历史快照」（当时买了啥），按真实电商惯例保留各自一份，
 * 不从这里取（见 data/orders.js、data/aftersales.js）。
 *
 * 以后接后端：换成 api/shop.js 的 getProduct(id) / getProducts()，字段保持一致。
 */
export const CATALOG = {
  'prod-1': { id: 'prod-1', name: '幸运小鸭礼盒', tag: '送礼首选', price: 198, was: 258 },
  'prod-2': { id: 'prod-2', name: '进阶套装 · 小伙伴们', tag: '4 只装', price: 399, was: 499 },
  'prod-3': { id: 'prod-3', name: '微笑小鸡 · 入门', tag: '零基础首选', price: 128, was: 168 },
  'prod-4': { id: 'prod-4', name: '幸运小鸭 · 单只', tag: '单只装', price: 98, was: 138 },
  'prod-5': { id: 'prod-5', name: '云朵小羊 · 入门', tag: '入门首选', price: 148, was: 198 },
}

// 按 id 取单个商品（取不到返回 null）
export const getProduct = (id) => CATALOG[id] || null

// 首页横滑展示的商品（featured）
export const FEATURED_IDS = ['prod-1', 'prod-2', 'prod-3']

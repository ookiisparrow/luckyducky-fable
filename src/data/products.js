/**
 * 首页产品横滑数据 —— 从商品总表 data/catalog.js 按 featured 派生（单一来源）。
 * 保持「字符串价(￥X.00)」形状，首页 ProductCard 模板不动。
 * 以后接后端：用 api/shop.js 的 getProducts() 返回同形状即可。
 */
import { CATALOG, FEATURED_IDS, yuan } from './catalog.js'

export const PRODUCTS = FEATURED_IDS.map((id) => {
  const p = CATALOG[id]
  return { id: p.id, name: p.name, tag: p.tag, was: yuan(p.was), now: yuan(p.price) }
})

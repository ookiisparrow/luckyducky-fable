/**
 * 购物车「为你推荐」—— 从商品总表 data/catalog.js 按 id 派生（单一来源）。
 * 条目即总表里的商品（含 id/name/tag/price/was，数字价），点 ＋ 直接进 store。
 * 以后接后端：换成 api/shop.js 的 getCartRecs()。
 */
import { CATALOG } from './catalog.js'

export const CART_RECS = ['prod-3', 'prod-1'].map((id) => CATALOG[id])

/**
 * 购物车「为你推荐」数据。来源：原型 Sections.jsx 的 CART_RECS。
 * price / was 为数字（点 ＋ 加入购物车时直接进 store 算合计）。
 * 以后接后端：改为 api/shop.js 的 getCartRecs()，字段保持一致。
 */
export const CART_RECS = [
  { id: 'prod-3', name: '微笑小鸡 · 入门', tag: '零基础首选', price: 128, was: 168 },
  { id: 'prod-1', name: '幸运小鸭礼盒', tag: '送礼首选', price: 198, was: 258 },
]

/**
 * 结算页静态数据。来源：原型 Checkout.jsx（CO_ADDONS / 金额常量）。
 * 以后接后端：搭配推荐走 api/shop.js、优惠/运费由下单接口返回。
 * （样例地址已迁 data/address.js —— 地址属用户域，技术债 #3。）
 */

// 搭配购买（可勾选 + 调数量），price 为数字
export const CHECKOUT_ADDONS = [
  { id: 'hook', name: '替换钩针组 · 2.5 / 3.0mm', price: 39, on: false },
  { id: 'yarn', name: '补充棉线包 · 暖色 5 色', price: 29, on: true },
]

export const COUPON = 20 // 优惠券抵扣
export const SHIP = 0 // 运费（0 = 包邮）

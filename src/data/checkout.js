/**
 * 结算页静态数据。来源：原型 Checkout.jsx（CO_ADDONS / DEFAULT_ADDR / 金额常量）。
 * 以后接后端：搭配推荐走 api/shop.js、地址走 api/user.js、优惠/运费由下单接口返回。
 */

// 搭配购买（可勾选 + 调数量），price 为数字
export const CHECKOUT_ADDONS = [
  { id: 'hook', name: '替换钩针组 · 2.5 / 3.0mm', price: 39, on: false },
  { id: 'yarn', name: '补充棉线包 · 暖色 5 色', price: 29, on: true },
]

// 样例收货地址（地址簿功能在「个人中心」步骤再做；这里先给默认地址让结算可提交）
export const SAMPLE_ADDRESS = {
  name: '陈圆圆',
  phone: '138 0000 1234',
  isDefault: true,
  region: '浙江省 杭州市 西湖区',
  detail: '文三路 478 号华星时代广场 A 座 1502 室',
}

export const COUPON = 20 // 优惠券抵扣
export const SHIP = 0 // 运费（0 = 包邮）

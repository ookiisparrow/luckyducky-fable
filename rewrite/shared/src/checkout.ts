/**
 * 结算搭配购 + 优惠/运费常量——单一来源（防镜像副本漂移）。
 * 云端 createOrder 派生权威定价；mp 派生 UI。
 * 主线 COUPON 恒 0：开发版/发布版不抵扣、顾客页不展示优惠券（老板明令）。
 * 真券/领取只在 git test / yaliceshi，禁止合进 main。
 */
export interface CheckoutAddon {
  id: string
  name: string
  price: number
}

export const CHECKOUT_ADDONS: CheckoutAddon[] = [
  { id: 'hook', name: '替换钩针组 · 2.5 / 3.0mm', price: 39 },
  { id: 'yarn', name: '补充棉线包 · 暖色 5 色', price: 29 },
]

export const COUPON = 0 // 主线不抵扣（元）；顾客可见版本禁展示优惠券
export const SHIP = 0 // 运费（0 = 包邮）

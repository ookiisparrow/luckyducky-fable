/**
 * 结算搭配购 + 优惠/运费常量——单一来源（设计约束#5 镜像消灭·镜像旧线 seed/checkout.ts，parity 焊死）。
 * 云端 createOrder 派生权威定价；miniapp（M2）派生 UI。占位券 COUPON 开发期无条件抵扣，真实券系统一并替换只改这里。
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

export const COUPON = 20 // 优惠券抵扣（元·占位）
export const SHIP = 0 // 运费（0 = 包邮）

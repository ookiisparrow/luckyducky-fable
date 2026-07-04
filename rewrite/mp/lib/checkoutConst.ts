// 结算常量副本（镜像 rewrite/shared/src/checkout.ts·守卫 rw-mp-checkout-consts-synced 焊死逐值一致——
// mp 包进不了 @ldrw/shared（开发者工具编译不出仓外引用），改值先改 shared 再同步这里，守卫红了别绕）。
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

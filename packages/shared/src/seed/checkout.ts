/**
 * 结算搭配购 + 优惠/运费常量——单一来源（根因账本 #5 复制即漂移 / #6 镜像靠注释维系）。
 * 病史：原 createOrder.ts（云端权威定价）与 miniapp data/checkout.js（UI 展示）逐字镜像、
 * 仅靠注释「与 … 镜像」维系且路径已 stale——round-2 体检收为单源（2026-06-14）。
 * 云端 createOrder 派生 Record 作权威定价；miniapp 派生数组 + UI 默认勾选态（presentation-only）。
 * 占位券（开发期 COUPON 无条件抵扣）：P4 接真实券系统时一并替换——单源后只改这里。
 */
export interface CheckoutAddon {
  id: string
  name: string
  price: number
}

// 搭配购买（可勾选 + 调数量）；price 单位元。
export const CHECKOUT_ADDONS: CheckoutAddon[] = [
  { id: 'hook', name: '替换钩针组 · 2.5 / 3.0mm', price: 39 },
  { id: 'yarn', name: '补充棉线包 · 暖色 5 色', price: 29 },
]

export const COUPON = 20 // 优惠券抵扣（元）
export const SHIP = 0 // 运费（0 = 包邮）

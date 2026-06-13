/**
 * 结算页搭配/券/运费——派生自单一来源 @luckyducky/shared（根因#5/#6，与云端 createOrder 同源）。
 * 本文件只叠加 UI 默认勾选态（presentation-only）；价格/券/运费改这里无效，改 shared/seed/checkout。
 * （样例地址已迁 data/address.js —— 地址属用户域，技术债 #3。）
 */
import { CHECKOUT_ADDONS as ADDONS_BASE, COUPON, SHIP } from '@luckyducky/shared'

// 搭配购买（可勾选 + 调数量）：定价单源 shared，叠加 UI 默认勾选态（yarn 默认勾选）
export const CHECKOUT_ADDONS = ADDONS_BASE.map((a) => ({ ...a, on: a.id === 'yarn' }))

export { COUPON, SHIP }

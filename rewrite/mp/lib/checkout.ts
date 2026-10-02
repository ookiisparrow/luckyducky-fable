// 结算草稿（只在内存，冷启动即清空）。来源两种：购物车「去结算」（fromCart，下单成功后扣车）、
// 详情页「立即购买」单件（不动购物车）。
import { CHECKOUT_ADDONS, COUPON, SHIP, type CheckoutAddon } from './checkoutConst'
import * as cart from './cart'

// checkoutConst 里 hook/yarn 是占位、不是真商品：不展示，但算账仍认 CHECKOUT_ADDONS。
const PLACEHOLDER_ADDON_IDS = new Set(['hook', 'yarn'])
export function sellableAddons(): CheckoutAddon[] {
  return CHECKOUT_ADDONS.filter((a) => !PLACEHOLDER_ADDON_IDS.has(a.id))
}

/** 搭配购行：恒 1 件、不扣购物车、不能单独成单。 */
export const isAddon = (id: string): boolean => CHECKOUT_ADDONS.some((a) => a.id === id)

export interface DraftLine {
  id: string
  sku: string
  name: string
  tag: string
  price: number // 元
  qty: number
  cover: string
  lineId: string // cart.lineIdOf
}

let draftItems: DraftLine[] = []
let fromCart = false
// 幂等键：网络超时后用户再点一次，云端凭同一个键认出是同一单、不建二单。
// 规则：草稿生成时新建；草稿内容一变就换（否则改了数量再提交，会被折回旧数量的那张单）；下单成功即清。
let idemKey = ''
const newIdemKey = (): string => Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10)

export function prepareFromCart(): void {
  draftItems = cart
    .getItems()
    .filter((it) => it.selected)
    .map((it) => ({ id: it.id, sku: it.sku, name: it.name, tag: it.tag, price: it.price, qty: it.qty, cover: it.cover, lineId: it.lineId }))
  fromCart = true
  idemKey = newIdemKey()
}

export function prepareBuyNow(p: { id: string; sku?: string; name: string; tag?: string; price: number; cover?: string }): void {
  const sku = p.sku || ''
  draftItems = [{ id: p.id, sku, name: p.name, tag: p.tag || '', price: p.price, qty: 1, cover: p.cover || '', lineId: cart.lineIdOf(p.id, sku) }]
  fromCart = false
  idemKey = newIdemKey()
}

export function getDraft(): { items: DraftLine[]; fromCart: boolean } {
  return { items: draftItems.map((l) => ({ ...l })), fromCart }
}

/** 草稿为空时返回空串。 */
export function getIdemKey(): string {
  return draftItems.length ? idemKey : ''
}

/** 搭配购勾选/取消。 */
export function toggleAddon(addonId: string): void {
  const a = CHECKOUT_ADDONS.find((x) => x.id === addonId)
  if (!a) return
  const i = draftItems.findIndex((l) => l.id === addonId)
  if (i >= 0) draftItems.splice(i, 1)
  else draftItems.push({ id: a.id, sku: '', name: a.name, tag: '搭配购', price: a.price, qty: 1, cover: '', lineId: cart.lineIdOf(a.id, '') })
  idemKey = newIdemKey()
}

// 手抄自 shared/src/limits.ts（mp 引不了 shared），超了云端拒 BAD_QTY；tests/checkout.test 会核两边一致
export const MAX_QTY = 999

/** 结算页改数量：只改草稿、不回写购物车；超出 1..MAX_QTY 或是搭配购就不动。返回改没改。 */
export function bumpQty(lineId: string, delta: number): boolean {
  const l = draftItems.find((x) => x.lineId === lineId)
  const q = l ? l.qty + delta : 0
  if (!l || q < 1 || q > MAX_QTY || isAddon(l.id)) return false
  l.qty = q
  idemKey = newIdemKey()
  return true
}

/** 草稿按现价同步（搭配购不在商品列表里，不动）；返回有没有哪行价变了。 */
export function syncDraftPrices(allRaw: Record<string, unknown>[]): boolean {
  let changed = false
  for (const l of draftItems) {
    const n = cart.latestPrice(l, allRaw)
    if (n !== null && Math.round(n * 100) !== Math.round(l.price * 100)) {
      l.price = n
      changed = true
    }
  }
  return changed
}

/** 金额（分），公式同云端 createOrder：应付 = max(0, 商品 + 运费 − 券)。仅展示，以云端为准。 */
export function summaryFen(): { goodsFen: number; shipFen: number; couponFen: number; amountFen: number } {
  const goodsFen = draftItems.reduce((n, l) => n + Math.round(l.price * 100) * l.qty, 0)
  const shipFen = Math.round(SHIP * 100)
  const couponFen = Math.round(COUPON * 100)
  return { goodsFen, shipFen, couponFen, amountFen: Math.max(0, goodsFen + shipFen - couponFen) }
}

export const fenLabel = (fen: number): string => '¥' + (fen / 100).toFixed(2)

/** 下单成功：来自购物车的按实际数量扣车，清草稿。 */
export function finishSubmitted(): void {
  if (fromCart) cart.consume(draftItems.filter((l) => !isAddon(l.id)).map((l) => ({ id: l.id, sku: l.sku, qty: l.qty })))
  draftItems = []
  fromCart = false
  idemKey = ''
}

/** 成功页金额（分）：用云端回包的 order.amount（元）；回包缺了才退回前端估算。 */
export function resolveOrderAmountFen(order: unknown, fallbackFen: number): number {
  const o = (order && typeof order === 'object' ? order : {}) as Record<string, unknown>
  const n = Number(o.amount)
  return Number.isFinite(n) ? Math.round(n * 100) : fallbackFen
}

// 手抄自 shared ERR.OUT_OF_STOCK（mp 引不了 shared），check-structure 会核两边一致
const OUT_OF_STOCK_PREFIX = 'OUT_OF_STOCK'

// 云端拒单码 → 人话。码值手抄自云端 createOrder，云端改名时 tests/q-mp-err-codes-synced 会红。
// 带冒号的码（UNLISTED_ITEM:<id> 等）按冒号前的部分认。
// ⚠ 本文件的文案只能用 assets/brand-fonts/tier1.txt 里有的字（购物车首屏字体子集），否则要重建字体。
export const CREATE_ORDER_ERR_COPY: Record<string, string> = {
  UNLISTED_ITEM: '有商品已下架',
  UNKNOWN_ITEM: '有商品已不存在',
  UNKNOWN_SKU: '有商品的这一款已下架',
  TOO_MANY_PENDING: '待支付的订单太多了，先到「我 → 我的订单」里处理',
  BAD_ADDRESS: '收货地址不完整，请检查',
  BAD_QTY: '有商品数量太多了，请调整数量',
  TOO_MANY_ITEMS: '商品太多了，请分开下单',
  // 后台把价格配坏了，用户自己解决不了，指去客服
  BAD_SKU_PRICE: '有商品价格异常，暂时买不了，请联系客服',
  BAD_PRICE: '有商品价格异常，暂时买不了，请联系客服',
  COUPON_EXCEEDS_GOODS: '优惠券暂不支持抵扣这单，请调整商品数量',
  RATE_LIMITED: '点太快了，稍后再试',
  CALL_TIMEOUT: '网络不好，稍后再试',
  CALL_FAIL: '网络不好，稍后再试',
}

/** 没列到的码才落通用句。 */
export function mapCreateOrderError(msg: string): string {
  const m = String(msg || '')
  if (m.startsWith(OUT_OF_STOCK_PREFIX)) return '有商品库存不足'
  const code = m.split(':')[0]
  return Object.prototype.hasOwnProperty.call(CREATE_ORDER_ERR_COPY, code) ? CREATE_ORDER_ERR_COPY[code] : '下单没成功，稍后再试'
}

/** 云端说「这件买不了」（下架/删档/规格没了）时，把那一行移出草稿和购物车，否则同一草稿会永远被拒。
 *  返回被移走的商品名；别的错误码回 ''。移完只剩搭配购就清空（搭配购不能单买）。 */
export function dropRejectedLine(msg: string): string {
  const [code, id, ...rest] = String(msg || '').split(':')
  if (!id || !(code === 'UNLISTED_ITEM' || code === 'UNKNOWN_ITEM' || code === 'UNKNOWN_SKU')) return ''
  const sku = code === 'UNKNOWN_SKU' ? rest.join(':') : null // 下架/删档是整件，规格没了只挑这一规格
  const hit = draftItems.filter((l) => l.id === id && (sku === null || l.sku === sku))
  if (!hit.length) return ''
  draftItems = draftItems.filter((l) => !hit.includes(l))
  if (fromCart) hit.forEach((l) => cart.remove(l.id, l.sku))
  if (draftItems.every((l) => isAddon(l.id))) draftItems = []
  return hit[0].name + (sku ? '（' + sku + '）' : '')
}

/** 仅测试：清草稿。 */
export function __resetForTest(): void {
  draftItems = []
  fromCart = false
  idemKey = ''
}

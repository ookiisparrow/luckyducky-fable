// 结算草稿（旧线 cart store 的 checkoutItems 半边·临时态不持久化——冷启动不残留旧草稿）：
// 购物车「去结算」快照选中项（fromCart=true·提交成功按实际数量精确扣车）；
// 详情「立即购买」单件成稿（fromCart=false·不动购物车）。金额分口径与 cart 同源。
import { CHECKOUT_ADDONS, COUPON, SHIP, type CheckoutAddon } from './checkoutConst'
import * as cart from './cart'

// checkoutConst 里 hook/yarn 是写死占位、不是货架真 SKU。展示层过滤掉，钱账仍认 CHECKOUT_ADDONS。
const PLACEHOLDER_ADDON_IDS = new Set(['hook', 'yarn'])
export function sellableAddons(): CheckoutAddon[] {
  return CHECKOUT_ADDONS.filter((a) => !PLACEHOLDER_ADDON_IDS.has(a.id))
}

export interface DraftLine {
  id: string
  sku: string
  name: string
  tag: string
  price: number // 元
  qty: number
  cover: string
  lineId: string // 行唯一键（wx:key 用·批5）：id+sku 双键合成，同 cart.lineIdOf 口径
}

let draftItems: DraftLine[] = []
let fromCart = false
// 幂等键（批E·P1 防网络超时重试双建单）：结算草稿创建时生成一次、随草稿存活；提交失败重试（同一
// 草稿未变）复用同一个键——云端 createOrder 据此把「同一次提交的重试」CAS 折叠成同一笔订单，
// 网络超时后用户点第二次不会重复扣库存/建二单。草稿清空（finishSubmitted/__resetForTest）即失效，
// 下次结算重新生成，不会跨草稿误粘。
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

/** 本次结算草稿的幂等键（提交/重试传给 createOrder；草稿为空时返回空串——没有可提交的草稿）。 */
export function getIdemKey(): string {
  return draftItems.length ? idemKey : ''
}

/** 搭配购增删（id ∈ CHECKOUT_ADDONS·qty 恒 1·重复添加幂等）。 */
export function toggleAddon(addonId: string): void {
  const a = CHECKOUT_ADDONS.find((x) => x.id === addonId)
  if (!a) return
  const i = draftItems.findIndex((l) => l.id === addonId)
  if (i >= 0) draftItems.splice(i, 1)
  else draftItems.push({ id: a.id, sku: '', name: a.name, tag: '搭配购', price: a.price, qty: 1, cover: '', lineId: cart.lineIdOf(a.id, '') })
}

/** 金额汇总（分整数·与云端 createOrder 同式：应付 = max(0, 商品 + 运费 − 券)；主线券恒 0）。 */
export function summaryFen(): { goodsFen: number; shipFen: number; couponFen: number; amountFen: number } {
  const goodsFen = draftItems.reduce((n, l) => n + Math.round(l.price * 100) * l.qty, 0)
  const shipFen = Math.round(SHIP * 100)
  const couponFen = Math.round(COUPON * 100)
  return { goodsFen, shipFen, couponFen, amountFen: Math.max(0, goodsFen + shipFen - couponFen) }
}

export const fenLabel = (fen: number): string => '¥' + (fen / 100).toFixed(2)

/** 提交成功收尾：来自购物车的按实际提交数量精确扣（cart.consume 语义）；清草稿。 */
export function finishSubmitted(): void {
  if (fromCart) cart.consume(draftItems.filter((l) => !CHECKOUT_ADDONS.some((a) => a.id === l.id)).map((l) => ({ id: l.id, sku: l.sku, qty: l.qty })))
  draftItems = []
  fromCart = false
  idemKey = ''
}

/** 建单成功页展示金额（分）：优先取 createOrder 回包权威值（order.amount 为元）；
 * 回包缺失/非数字才回退调用方传入的前端自算值（防御分支，正常必有 amount）（bug sweep R1 #1）。 */
export function resolveOrderAmountFen(order: unknown, fallbackFen: number): number {
  const o = (order && typeof order === 'object' ? order : {}) as Record<string, unknown>
  const n = Number(o.amount)
  return Number.isFinite(n) ? Math.round(n * 100) : fallbackFen
}

// 必须与 rewrite/shared/src/errors.ts 的 ERR.OUT_OF_STOCK 值一致——mp 进不了 @ldrw/shared（开发者工具编译限制），手动同步
const OUT_OF_STOCK_PREFIX = 'OUT_OF_STOCK'

// 云端拒单码 → 人话（码值镜像 cloud app/actions/orders.ts createOrder 与 shared/src/errors.ts，手动同步；
// 云端改名/改冒号格式时 tests/q-mp-err-codes-synced 会红）。
// 带冒号的码（UNLISTED_ITEM:<id> 等）按前缀认。没列到的才落通用句——通用句只配真没法归因的失败。
// 本文件在购物车 tab 首屏字体闭包里：措辞只用 tier1 子集已有的字（守卫 rw-mp-font-tier-subset-covers），
// 换字前先查 assets/brand-fonts/tier1.txt，否则要重建字体。
export const CREATE_ORDER_ERR_COPY: Record<string, string> = {
  UNLISTED_ITEM: '有商品已下架',
  UNKNOWN_ITEM: '有商品已不存在',
  UNKNOWN_SKU: '有商品的这一款已下架',
  TOO_MANY_PENDING: '待付款的订单太多了，先到「我的订单」里处理',
  BAD_ADDRESS: '收货地址不完整，请检查',
  BAD_QTY: '有商品数量太多了，请调整数量',
  TOO_MANY_ITEMS: '商品太多了，请分开下单',
  COUPON_EXCEEDS_GOODS: '优惠券暂不支持抵扣这单，请调整商品数量',
  RATE_LIMITED: '点太快了，稍后再试',
  CALL_TIMEOUT: '网络不好，稍后再试',
  CALL_FAIL: '网络不好，稍后再试',
}

/** 建单失败错误码 → 人话文案（云端拒单原样透传·前端只做展示映射，不吞成通用失败）（bug sweep R1 #2）。 */
export function mapCreateOrderError(msg: string): string {
  const m = String(msg || '')
  if (m.startsWith(OUT_OF_STOCK_PREFIX)) return '有商品库存不足'
  const code = m.split(':')[0]
  return Object.prototype.hasOwnProperty.call(CREATE_ORDER_ERR_COPY, code) ? CREATE_ORDER_ERR_COPY[code] : '下单没成功，稍后再试'
}

/** 云端说「这件买不了」（下架/删档/规格没了·整单拒）时把那一行移出草稿（来自购物车的也移出购物车），
 *  否则同一草稿永远被拒、用户只能干等。返回被移走的商品名；别的码不动任何行、回 ''。
 *  移完只剩搭配购则清空草稿（云端 NO_MAIN_ITEM 不许单买搭配购）。 */
export function dropRejectedLine(msg: string): string {
  const [code, id, ...rest] = String(msg || '').split(':')
  if (!id || !(code === 'UNLISTED_ITEM' || code === 'UNKNOWN_ITEM' || code === 'UNKNOWN_SKU')) return ''
  const sku = code === 'UNKNOWN_SKU' ? rest.join(':') : null // 下架/删档是整件，规格没了只挑这一规格
  const hit = draftItems.filter((l) => l.id === id && (sku === null || l.sku === sku))
  if (!hit.length) return ''
  draftItems = draftItems.filter((l) => !hit.includes(l))
  if (fromCart) hit.forEach((l) => cart.remove(l.id, l.sku))
  if (draftItems.every((l) => CHECKOUT_ADDONS.some((a) => a.id === l.id))) draftItems = []
  return hit[0].name + (sku ? '（' + sku + '）' : '')
}

/** 仅测试：清草稿。 */
export function __resetForTest(): void {
  draftItems = []
  fromCart = false
  idemKey = ''
}

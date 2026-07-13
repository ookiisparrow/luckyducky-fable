// 结算草稿（旧线 cart store 的 checkoutItems 半边·临时态不持久化——冷启动不残留旧草稿）：
// 购物车「去结算」快照选中项（fromCart=true·提交成功按实际数量精确扣车）；
// 详情「立即购买」单件成稿（fromCart=false·不动购物车）。金额分口径与 cart 同源。
import { CHECKOUT_ADDONS, COUPON, SHIP } from './checkoutConst'
import * as cart from './cart'

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

/** 金额汇总（分整数·与云端 createOrder 同式：应付 = max(0, 商品 + 运费 − 券)）。 */
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

/** 建单失败错误码 → 人话文案（云端拒单原样透传·前端只做展示映射，不吞成通用失败）（bug sweep R1 #2）。 */
export function mapCreateOrderError(msg: string): string {
  const m = String(msg || '')
  if (m.startsWith(OUT_OF_STOCK_PREFIX)) return '有商品库存不足'
  if (m === 'COUPON_EXCEEDS_GOODS') return '优惠券暂不支持抵扣这单，请调整商品数量'
  return '下单没成功，稍后再试'
}

/** 仅测试：清草稿。 */
export function __resetForTest(): void {
  draftItems = []
  fromCart = false
  idemKey = ''
}

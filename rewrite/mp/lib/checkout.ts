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
}

let draftItems: DraftLine[] = []
let fromCart = false

export function prepareFromCart(): void {
  draftItems = cart
    .getItems()
    .filter((it) => it.selected)
    .map((it) => ({ id: it.id, sku: it.sku, name: it.name, tag: it.tag, price: it.price, qty: it.qty, cover: it.cover }))
  fromCart = true
}

export function prepareBuyNow(p: { id: string; sku?: string; name: string; tag?: string; price: number; cover?: string }): void {
  draftItems = [{ id: p.id, sku: p.sku || '', name: p.name, tag: p.tag || '', price: p.price, qty: 1, cover: p.cover || '' }]
  fromCart = false
}

export function getDraft(): { items: DraftLine[]; fromCart: boolean } {
  return { items: draftItems.map((l) => ({ ...l })), fromCart }
}

/** 搭配购增删（id ∈ CHECKOUT_ADDONS·qty 恒 1·重复添加幂等）。 */
export function toggleAddon(addonId: string): void {
  const a = CHECKOUT_ADDONS.find((x) => x.id === addonId)
  if (!a) return
  const i = draftItems.findIndex((l) => l.id === addonId)
  if (i >= 0) draftItems.splice(i, 1)
  else draftItems.push({ id: a.id, sku: '', name: a.name, tag: '搭配购', price: a.price, qty: 1, cover: '' })
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
}

/** 仅测试：清草稿。 */
export function __resetForTest(): void {
  draftItems = []
  fromCart = false
}

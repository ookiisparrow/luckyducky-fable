// 购物车：一行＝「商品 id + 规格 sku」（同商品不同规格各成一行，同规格合并加量）。
// 存 wx.storage，读回必过 sanitizeCart（脏条目丢弃）。合计按「分」整数累加——元的浮点直接相加会有尾差。
import { readStorage, writeStorage } from '../utils/storage'

export interface CartItem {
  id: string
  sku: string
  name: string
  tag: string
  price: number // 元（数字·算合计用分累加）
  was?: number
  cover: string
  qty: number
  selected: boolean
}

const KEY = 'ld:cart'
let items: CartItem[] | null = null // 惰性加载（测试可先桩 wx 再触发）

/** 有 id、price 是数字、有 name、qty 是正整数才留（小数数量整条丢、不取整）；sku 缺失归空串（兼容无规格的旧数据）。 */
function sanitizeCart(raw: unknown): CartItem[] {
  const list = raw && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>).items) ? ((raw as Record<string, unknown>).items as unknown[]) : []
  const out: CartItem[] = []
  for (const it of list as Record<string, any>[]) {
    if (!it || it.id == null || typeof it.price !== 'number' || !it.name) continue
    if (!Number.isInteger(it.qty) || it.qty < 1) continue
    out.push({
      id: String(it.id),
      sku: typeof it.sku === 'string' ? it.sku : '',
      name: String(it.name),
      tag: String(it.tag || ''),
      price: it.price,
      was: typeof it.was === 'number' ? it.was : undefined,
      cover: String(it.cover || ''),
      qty: it.qty,
      selected: !!it.selected,
    })
  }
  return out
}

function load(): CartItem[] {
  return items ?? (items = sanitizeCart(readStorage(KEY))) // 坏存档读回 null → 空车
}

function save(): void {
  writeStorage(KEY, { items: load() }) // 存不进时下次会话回灌旧值
}

const keyOf = (id: string, sku: string) => (it: CartItem) => it.id === id && it.sku === (sku || '')

/** 行唯一键（wx:key 用）：单用 id 会撞（同商品不同规格是两行）。只在视图层派生，不存进 storage。 */
export function lineIdOf(id: string, sku: string): string {
  return id + '__' + (sku || '')
}

/** 加购：同 id+sku 合并 +1，否则新建一行（数量 1·默认选中）。 */
export function add(p: { id: string; sku?: string; name: string; tag?: string; price: number; was?: number; cover?: string }): void {
  const list = load()
  const sku = p.sku || ''
  const ex = list.find(keyOf(p.id, sku))
  if (ex) ex.qty += 1
  else list.push({ id: p.id, sku, name: p.name, tag: p.tag || '', price: p.price, was: p.was, cover: p.cover || '', qty: 1, selected: true })
  save()
}

export function remove(id: string, sku = ''): void {
  items = load().filter((it) => !keyOf(id, sku)(it))
  save()
}

/** 相对增减（最少 1）。步进器用它而不是传页面上的数量：连点时页面还没刷新，多次读到同一个旧值会丢掉增量。 */
export function bump(id: string, delta: number, sku = ''): void {
  const it = load().find(keyOf(id, sku))
  if (it) it.qty = Math.max(1, it.qty + delta)
  save()
}

export function toggle(id: string, sku = ''): void {
  const it = load().find(keyOf(id, sku))
  if (it) it.selected = !it.selected
  save()
}

export function getItems(): Array<CartItem & { lineId: string }> {
  return load().map((it) => ({ ...it, lineId: lineIdOf(it.id, it.sku) }))
}

export const selectedCount = (): number => load().reduce((n, it) => (it.selected ? n + it.qty : n), 0)

/** 选中合计（分）。逐行 Math.round：0.1 元 ×100 浮点会带尾数。 */
export function selectedTotalFen(): number {
  return load().reduce((n, it) => (it.selected ? n + Math.round(it.price * 100) * it.qty : n), 0)
}

export function selectedTotalLabel(): string {
  return '¥' + (selectedTotalFen() / 100).toFixed(2)
}

/** 下单成功后按实际提交数量扣，扣到 0 才删行（结算页可能只买了车里的一部分数量）。 */
export function consume(lines: Array<{ id: string; sku?: string; qty: number }>): void {
  const list = load()
  for (const line of lines) {
    const it = list.find(keyOf(line.id, line.sku || ''))
    if (!it) continue
    it.qty -= line.qty || 0
    if (it.qty <= 0) items = load().filter((x) => x !== it)
  }
  save()
}

/** 仅测试：重置内存态强制下次重新回灌。 */
export function __resetForTest(): void {
  items = null
}

/** 这一行的现价（元），取法同云端 createOrder：有规格取规格价，否则取商品价。
 *  查不到（下架/删档/规格没了/价不合法）回 null，调用方不动这一行——留给下单时云端拒单、
 *  checkout.dropRejectedLine 点名移出，不在这里悄悄删。 */
export function latestPrice(line: { id: string; sku: string }, allRaw: Record<string, unknown>[]): number | null {
  const p = allRaw.find((x) => String(x.id || x._id || '') === line.id) as Record<string, any> | undefined
  if (!p) return null
  const src = line.sku ? (Array.isArray(p.skus) ? p.skus : []).find((s: any) => s && s.name === line.sku) : p
  const n = Number(src && src.price)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** 用现价覆盖车里各行并写回本地；返回有没有哪行价变了（页面据此提示「价格有变动」）。 */
export function syncPrices(allRaw: Record<string, unknown>[]): boolean {
  let changed = false
  for (const it of load()) {
    const n = latestPrice(it, allRaw)
    if (n !== null && Math.round(n * 100) !== Math.round(it.price * 100)) {
      it.price = n
      changed = true
    }
  }
  if (changed) save()
  return changed
}

/** 展示用封面：云端给的 cover 是约 2 小时过期的临时地址，存在购物车里的旧地址隔天就挂了。
 *  优先用刚拉到的商品列表里的新地址，查不到才退回存的旧地址。 */
export function freshCover(line: { id: string; cover: string }, allRaw: Record<string, unknown>[]): string {
  const p = allRaw.find((x) => String(x.id || x._id || '') === line.id)
  const fresh = p && typeof p.cover === 'string' ? p.cover.trim() : ''
  return fresh || line.cover
}

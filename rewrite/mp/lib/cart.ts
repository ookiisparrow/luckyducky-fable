// 购物车模块 store（黄金 frontend-store §一/§二钉行为·旧线 Pinia cart 的原生承接）：
// 行身份=「商品 id + 规格 sku」双键（同商品不同规格各成独立行·同规格合并加量）；
// 持久化 wx.storage、回灌必过 sanitizeCart 清洗（脏条目丢弃·防旧数据撑乱列表）；
// 合计走「分」整数累加再回两位小数展示（元浮点直加会漂·黄金 §四 金额恒两位小数）。
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

/** 回灌契约（导出供测试·单一来源）：有 id、price 是数字、有 name、qty 正整数才有效；
 *  小数数量直接丢弃不 floor；selected 归一布尔；sku 缺失归一空串（历史无规格数据兼容双键定位）。 */
export function sanitizeCart(raw: unknown): CartItem[] {
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
  if (items) return items
  let raw: unknown = null
  try {
    raw = wx.getStorageSync(KEY)
  } catch {
    raw = null // 坏存档不崩·退回空车
  }
  items = sanitizeCart(raw)
  return items
}

function save(): void {
  try {
    wx.setStorageSync(KEY, { items: load() })
  } catch {
    /* 存不进不崩（下次会话回灌旧值） */
  }
}

const keyOf = (id: string, sku: string) => (it: CartItem) => it.id === id && it.sku === (sku || '')

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

export function setQty(id: string, qty: number, sku = ''): void {
  const it = load().find(keyOf(id, sku))
  if (it) it.qty = Math.max(1, qty)
  save()
}

/** 相对增减：读内存态当前 qty 再 ±delta（钳位 ≥1）。步进器用它、不传渲染层旧值——
 *  防一次 setData 往返内快速连点，多次读同一旧 data-qty 做绝对 setQty 丢增量（lost update）。 */
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

export function toggleAll(): void {
  const next = !allSelected()
  load().forEach((it) => (it.selected = next))
  save()
}

export function getItems(): CartItem[] {
  return load().map((it) => ({ ...it }))
}

export const isEmpty = (): boolean => load().length === 0
export const count = (): number => load().reduce((n, it) => n + it.qty, 0)
export const selectedCount = (): number => load().reduce((n, it) => (it.selected ? n + it.qty : n), 0)
export const allSelected = (): boolean => load().length > 0 && load().every((it) => it.selected)

/** 选中合计·分（整数·结算下单用同一口径——0.1 元这类价 ×100 浮点会带尾数，逐行 Math.round 后必为整数）。 */
export function selectedTotalFen(): number {
  return load().reduce((n, it) => (it.selected ? n + Math.round(it.price * 100) * it.qty : n), 0)
}

/** 选中合计展示（恒两位小数·由分整数派生）。 */
export function selectedTotalLabel(): string {
  return '¥' + (selectedTotalFen() / 100).toFixed(2)
}

/** 结算完成扣减（黄金 §一）：按「本次实际提交数量」精确扣——部分数量剩余保留；扣到 0 移除该行；
 *  双键定位不串同商品其他规格行。批5 结算链接线。 */
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

/** 清空（测试/登出用）。 */
export function clear(): void {
  items = []
  save()
}

/** 仅测试：重置内存态强制下次重新回灌。 */
export function __resetForTest(): void {
  items = null
}

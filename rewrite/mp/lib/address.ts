// 收货地址簿（黄金 frontend-store §五·旧线 Pinia address 原生承接）：
// 空簿不内置样例（真支付误发样例人=错发货）；新增 id 取现有最大+1（回灌后天然不撞号）；默认唯一。
export interface Address {
  id: number
  name: string
  phone: string
  region: string
  detail: string
  isDefault: boolean
}

const KEY = 'ld:address'
let list: Address[] | null = null

/** 回灌契约（导出供测试）：缺 id/姓名/电话/地区/详址的残缺地址丢弃（防污染结算默认地址）。 */
export function sanitizeAddresses(raw: unknown): Address[] {
  const arr = raw && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>).list) ? ((raw as Record<string, unknown>).list as unknown[]) : []
  const out: Address[] = []
  for (const a of arr as Record<string, any>[]) {
    if (!a || a.id == null || !a.name || !a.phone || !a.region || !a.detail) continue
    out.push({
      id: Number(a.id),
      name: String(a.name),
      phone: String(a.phone),
      region: String(a.region),
      detail: String(a.detail),
      isDefault: !!a.isDefault,
    })
  }
  return out
}

function load(): Address[] {
  if (list) return list
  let raw: unknown = null
  try {
    raw = wx.getStorageSync(KEY)
  } catch {
    raw = null
  }
  list = sanitizeAddresses(raw)
  return list
}

function save(): void {
  try {
    wx.setStorageSync(KEY, { list: load() })
  } catch {
    /* 存不进不崩 */
  }
}

// 下一个 id：现有最大+1（不用模块计数器——回灌后计数器归零会撞已存 id·旧线审定语义）
const nextId = (l: Address[]) => l.reduce((m, a) => Math.max(m, a.id || 0), 0) + 1

export function getList(): Address[] {
  return load().map((a) => ({ ...a }))
}

export function defaultAddress(): Address | null {
  const l = load()
  const hit = l.find((a) => a.isDefault) || l[0] || null
  return hit ? { ...hit } : null
}

export function getById(id: number): Address | null {
  const hit = load().find((a) => a.id === id)
  return hit ? { ...hit } : null
}

/** 新增（无 id）或编辑（有 id）；设默认互斥；全簿无默认则补第一条。 */
export function saveAddress(addr: { id?: number; name: string; phone: string; region: string; detail: string; isDefault?: boolean }): void {
  const l = load()
  let targetId = addr.id
  if (targetId != null) {
    const i = l.findIndex((a) => a.id === targetId)
    if (i >= 0) l[i] = { ...l[i], ...addr, id: targetId }
  } else {
    targetId = nextId(l)
    l.push({ name: addr.name, phone: addr.phone, region: addr.region, detail: addr.detail, isDefault: !!addr.isDefault, id: targetId })
  }
  if (addr.isDefault) l.forEach((a) => (a.isDefault = a.id === targetId))
  else if (l.length && !l.some((a) => a.isDefault)) l[0].isDefault = true
  save()
}

export function removeAddress(id: number): void {
  list = load().filter((a) => a.id !== id)
  if (list.length && !list.some((a) => a.isDefault)) list[0].isDefault = true
  save()
}

export function setDefault(id: number): void {
  load().forEach((a) => (a.isDefault = a.id === id))
  save()
}

/** 仅测试：重置内存态强制回灌。 */
export function __resetForTest(): void {
  list = null
}

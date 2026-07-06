// 订单映射（纯函数·黄金 frontend-store §七：脏单归一防白屏/渲染访问点纵深防御/金额恒两位小数/
// 状态中文化）（守卫 rw-mp-orders-golden）。
export interface OrderLineVM {
  lineId: string
  name: string
  spec: string
  priceLabel: string
  qty: number
  enteredQty: number
  refundable: boolean
  cover: string // 下单快照封面（cloud:// fileID）·旧单/搭配购无则空串
}

export interface OrderVM {
  id: string
  status: string
  statusLabel: string
  items: OrderLineVM[]
  count: number
  amountLabel: string
  createdAtLabel: string
  trackingNo: string
  shipCompany: string
  shippedAtLabel: string
  address: { name: string; phone: string; region: string; detail: string } | null
  goodsLabel: string
  shipLabel: string
  couponLabel: string
}

// 状态中文（shared ORDER_STATUS 全集·未知状态回原串不冒充）
const STATUS_LABELS: Record<string, string> = {
  pending: '待支付',
  paid: '待发货',
  shipped: '待收货',
  done: '已完成',
  closed: '已关闭',
  refund_required: '退款处理中',
}
export const statusLabel = (s: unknown): string => STATUS_LABELS[String(s)] || String(s || '')

const money = (v: unknown): string => {
  const n = Number(v)
  return Number.isFinite(n) ? '¥' + n.toFixed(2) : ''
}

/** 时间戳 → 'YYYY-MM-DD HH:mm'；非法返回空串（黄金 §四）。 */
export function dateTime(ts: unknown): string {
  const n = Number(ts)
  if (!Number.isFinite(n) || n <= 0) return ''
  const d = new Date(n)
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 条目访问器（纵深防御）：缺条目/null/非数组一律空数组，绝不抛错。 */
export function itemsOf(raw: unknown): OrderLineVM[] {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>
  if (!Array.isArray(o.items)) return []
  const out: OrderLineVM[] = []
  for (const it of o.items) {
    if (!it || typeof it !== 'object') continue
    out.push({
      lineId: String(it.lineId || it.productId || ''),
      name: String(it.name || ''),
      spec: String(it.spec || ''),
      priceLabel: money(it.price),
      qty: Number.isInteger(it.qty) && it.qty > 0 ? it.qty : 0,
      enteredQty: Number.isInteger(it.enteredQty) && it.enteredQty > 0 ? it.enteredQty : 0, // 旧单无字段视 0
      refundable: it.refundable !== false,
      cover: String(it.cover || ''), // 旧单/搭配购无字段→空串（模板 wx:if 回退灰底占位·不裂图）
    })
  }
  return out
}

/** 件数访问器（纵深防御）：脏单恒 0、不抛。 */
export const countOf = (raw: unknown): number => itemsOf(raw).reduce((n, it) => n + it.qty, 0)

/** 订单 → 视图模型（脏单归一·列表/详情共用）。无 id 的裸脏档返回 null（页面落「不存在」态）。 */
export function mapOrder(raw: unknown): OrderVM | null {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>
  const id = String(o.id || o._id || '')
  if (!id) return null
  const a = o.address && typeof o.address === 'object' ? o.address : null
  // 物流取自 shipping 子对象（admin shipOne 写 o.shipping={company,trackingNo}·非顶层）·脏形不抛
  const s = o.shipping && typeof o.shipping === 'object' ? o.shipping : {}
  return {
    id,
    status: String(o.status || ''),
    statusLabel: statusLabel(o.status),
    items: itemsOf(o),
    count: countOf(o),
    amountLabel: money(o.amount) || '¥0.00',
    createdAtLabel: dateTime(o.createdAt),
    trackingNo: String(s.trackingNo || ''),
    shipCompany: String(s.company || ''),
    shippedAtLabel: dateTime(o.shippedAt),
    address: a ? { name: String(a.name || ''), phone: String(a.phone || ''), region: String(a.region || ''), detail: String(a.detail || '') } : null,
    goodsLabel: money(o.goods),
    shipLabel: Number(o.ship) > 0 ? money(o.ship) : '包邮',
    couponLabel: Number(o.coupon) > 0 ? '-' + money(o.coupon) : '',
  }
}

/** 列表 → VM 列表（裸脏档整行剔除·不白屏）。 */
export function mapOrders(list: unknown): OrderVM[] {
  if (!Array.isArray(list)) return []
  return list.map(mapOrder).filter((x): x is OrderVM => !!x)
}

/** 按状态计数（「我」页角标/tab 数据源·无该状态不出假计数）。 */
export function countByStatus(list: OrderVM[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const o of list) {
    if (!o.status) continue
    out[o.status] = (out[o.status] || 0) + 1
  }
  return out
}

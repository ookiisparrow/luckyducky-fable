// 订单与钱组映射（纯函数·守卫 rw-admin-money-ui-golden）：v2 契约 → 页面 VM。
// 脏档安全同 mp 口径（缺条目恒数组/裸脏档剔除/金额恒两位）；近似诚实标注（approx 透传不隐藏）。
import { yuan, orderStatusLabel, refundStatusLabel, dateTime } from './format'

export interface StatCard {
  label: string
  value: string
  note?: string
}

export function mapDashboard(r: unknown): { cards: StatCard[]; funnel: StatCard[]; alerts: Array<{ label: string; ids: string[] }> } | null {
  const d = (r && typeof r === 'object' ? r : {}) as Record<string, any>
  if (d.ok !== true || !d.stats) return null
  const s = d.stats
  const approx = d.approx || {}
  const cards: StatCard[] = [
    { label: '注册用户', value: String(Number(s.users) || 0) },
    { label: '订单总数', value: String(Number(s.orders) || 0) },
    { label: '成交额（已付）', value: yuan(s.gmv), note: approx.gmv ? '近似' : '精确' },
    { label: '激活码（已激活/总）', value: `${Number(s.codesActivated) || 0} / ${Number(s.codesTotal) || 0}` },
    { label: '学习者', value: String(Number(s.learners) || 0) },
  ]
  const f = d.funnel || {}
  const funnel: StatCard[] = [
    { label: '下单', value: String(Number(f.ordered) || 0) },
    { label: '支付', value: String(Number(f.paid) || 0) },
    { label: '激活', value: String(Number(f.activated) || 0) },
  ]
  const t = d.txAlerts || {}
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : [])
  const alerts = [
    { label: '金额不符单', ids: list(t.feeMismatch) },
    { label: '退款金额不符', ids: list(t.refundMismatch) },
    { label: '审批后卡单', ids: list(t.stuckRefunds) },
  ].filter((a) => a.ids.length) // 无异常不渲染空警报（不吓人也不假绿：有则必显）
  return { cards, funnel, alerts }
}

export interface OrderRowVM {
  id: string
  statusLabel: string
  status: string
  summary: string
  count: number
  amountLabel: string
  timeLabel: string
  feeMismatch: boolean
  trackingNo: string
  address: string
  canShip: boolean
}

export function mapOrderRows(list: unknown): OrderRowVM[] {
  if (!Array.isArray(list)) return []
  const out: OrderRowVM[] = []
  for (const o of list as Record<string, any>[]) {
    if (!o || typeof o !== 'object') continue
    const id = String(o.id || o._id || '')
    if (!id) continue
    const items = Array.isArray(o.items) ? o.items : []
    const names = items.map((it: any) => String((it && it.name) || '')).filter(Boolean)
    const a = o.address && typeof o.address === 'object' ? o.address : {}
    out.push({
      id,
      status: String(o.status || ''),
      statusLabel: orderStatusLabel(o.status),
      summary: names.slice(0, 2).join('、') + (names.length > 2 ? ` 等 ${names.length} 件商品` : ''),
      count: items.reduce((n: number, it: any) => n + (Number.isInteger(it && it.qty) && it.qty > 0 ? it.qty : 0), 0),
      amountLabel: yuan(o.amount) || '¥0.00',
      timeLabel: dateTime(o.createdAt),
      feeMismatch: o.feeMismatch === true,
      trackingNo: String((o.shipping && o.shipping.trackingNo) || o.trackingNo || ''),
      address: [a.name, a.phone, a.region, a.detail].filter(Boolean).join(' '),
      canShip: o.status === 'paid' && o.feeMismatch !== true, // 金额不符单禁发货（云端也挡·这里只是入口收窄）
    })
  }
  return out
}

export interface RefundRowVM {
  id: string
  orderId: string
  statusLabel: string
  status: string
  what: string
  refundAmountLabel: string
  reason: string
  timeLabel: string
  canDecide: boolean
}

export function mapRefundRows(list: unknown): RefundRowVM[] {
  if (!Array.isArray(list)) return []
  const out: RefundRowVM[] = []
  for (const a of list as Record<string, any>[]) {
    if (!a || typeof a !== 'object') continue
    const id = String(a._id || '')
    if (!id) continue
    out.push({
      id,
      orderId: String(a.orderId || ''),
      status: String(a.status || ''),
      statusLabel: refundStatusLabel(a.status),
      what: `${String(a.name || '')}${a.spec ? '（' + String(a.spec) + '）' : ''} ×${Number(a.qty) || 0}`,
      refundAmountLabel: yuan(a.refundAmount) || '¥0.00',
      reason: String(a.reason || ''),
      timeLabel: dateTime(a.appliedAt),
      canDecide: String(a.status) === 'applied', // 只有待审核可同意/拒绝（云端原子抢占裁决·这里入口收窄）
    })
  }
  return out
}

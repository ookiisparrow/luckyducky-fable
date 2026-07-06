// 订单与钱组映射（纯函数·守卫 rw-admin-money-ui-golden）：v2 契约 → 页面 VM。
// 脏档安全同 mp 口径（缺条目恒数组/裸脏档剔除/金额恒两位）；近似诚实标注（approx 透传不隐藏）。
import { yuan, orderStatusLabel, refundStatusLabel, dateTime } from './format'

export interface StatCard {
  label: string
  value: string
  note?: string
  sub?: string // 副文案（漏斗逐环转化率「较上环 X%」·换皮丢了逐环转化率只剩绝对值）
  pct?: number // 进度条百分比（激活率·换皮把进度条退成纯「已激活/总」文本）
}

export interface SegStat {
  name: string
  count: number
}
export interface ActivityItem {
  type: string
  text: string
  at: number
}
export interface DashboardVM {
  cards: StatCard[]
  funnel: StatCard[]
  alerts: Array<{ label: string; ids: string[] }>
  hot: SegStat[] // 最多人看完的段位（换皮误删·后端 dashboard.ts hot=top(doneCount) 仍返回·B5）
  stuck: SegStat[] // 最多人卡住停留的段位
  recent: ActivityItem[] // 最近动态四类事件流（订单/激活/进课/退款·换皮退成纯订单列表）
  approxSeg: boolean // 热点/卡点为抽样近似（诚实标注·透传 approx.hot）
}

// 待处理行动条计数（治病根#14 admin 侧·守卫 rw-admin-money-ui-golden）：四路副请求各自可能失败，
// 换皮把失败的路 `.catch(()=>({}))` 兜成 0 → 四路全失败时「待处理」塌成绿色「今日无待处理事项 ✓」，
// 把「加载失败/未知」伪装成「真没待办」→ 运营据此漏发货。此处以 `.ok` 显式判失败并回传 partial，
// 让上层区分「真为 0」与「没加载到」：partial=true 时不显绿色全清、提示刷新。drafts.rows 由调用方先
// mapDraftRows（避免本层反向依赖 mapProducts）。
export interface TodoInputs {
  orderCounts: { ok?: boolean; counts?: Record<string, unknown> }
  refundCounts: { ok?: boolean; counts?: Record<string, unknown> }
  inventory: { ok?: boolean; list?: unknown }
  drafts: { ok?: boolean; rows?: Array<{ state?: string }> }
  low: number
}
export interface TodoCounts {
  ship: number
  refund: number
  lowStock: number
  prep: number
  partial: boolean // 任一路加载失败＝true（数字不可信·上层别显「无待办」全清）
}
export function deriveDashboardTodos(i: TodoInputs): TodoCounts {
  const partial = !(i.orderCounts?.ok && i.refundCounts?.ok && i.inventory?.ok && i.drafts?.ok)
  const ocC = (i.orderCounts?.counts || {}) as Record<string, unknown>
  const rcC = (i.refundCounts?.counts || {}) as Record<string, unknown>
  const invList = Array.isArray(i.inventory?.list) ? (i.inventory.list as Array<{ stock?: unknown }>) : []
  const rows = Array.isArray(i.drafts?.rows) ? i.drafts.rows : []
  return {
    ship: Number(ocC.paid) || 0,
    refund: Number(rcC.applied) || 0,
    lowStock: invList.filter((r) => typeof r?.stock === 'number' && (r.stock as number) <= i.low).length,
    prep: rows.filter((d) => d.state === 'preparing').length,
    partial,
  }
}

export function mapDashboard(r: unknown): DashboardVM | null {
  const d = (r && typeof r === 'object' ? r : {}) as Record<string, any>
  if (d.ok !== true || !d.stats) return null
  const s = d.stats
  const approx = d.approx || {}
  const codesTotal = Number(s.codesTotal) || 0
  const codesAct = Number(s.codesActivated) || 0
  const actRate = codesTotal ? Math.round((codesAct / codesTotal) * 100) : 0 // structure-ok：激活率百分比·非金额换算
  const cards: StatCard[] = [
    { label: '注册用户', value: String(Number(s.users) || 0) },
    { label: '订单总数', value: String(Number(s.orders) || 0) },
    { label: '成交额（已付）', value: yuan(s.gmv), note: approx.gmv ? '近似' : '精确' },
    // 激活码卡：进度条 + 激活率%（换皮丢了进度条/百分比·只剩「已激活/总」文本）
    { label: '激活码（已激活/总）', value: `${codesAct} / ${codesTotal}`, sub: codesTotal ? `激活率 ${actRate}%` : '', pct: codesTotal ? actRate : undefined },
    { label: '学习者', value: String(Number(s.learners) || 0) },
  ]
  const f = d.funnel || {}
  const ordered = Number(f.ordered) || 0
  const paid = Number(f.paid) || 0
  const activated = Number(f.activated) || 0
  // 逐环转化率（较上环 %·换皮丢·只剩绝对值看不出支付率/激活率）；首环无上环故空
  const conv = (n: number, prev: number) => (prev ? `较上环 ${Math.round((n / prev) * 100)}%` : '') // structure-ok：转化率百分比
  const funnel: StatCard[] = [
    { label: '下单', value: String(ordered), sub: '' },
    { label: '支付', value: String(paid), sub: conv(paid, ordered) },
    { label: '激活', value: String(activated), sub: conv(activated, paid) },
  ]
  const t = d.txAlerts || {}
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : [])
  const alerts = [
    { label: '金额不符单', ids: list(t.feeMismatch) },
    { label: '退款金额不符', ids: list(t.refundMismatch) },
    { label: '审批后卡单', ids: list(t.stuckRefunds) },
  ].filter((a) => a.ids.length) // 无异常不渲染空警报（不吓人也不假绿：有则必显）
  // 热点/卡点段位（B5·后端仍返回·换皮误以为「无数据源」删掉）：top(doneCount)/top(stuckCount)＝[{segId,name,count}]
  const seg = (v: unknown): SegStat[] =>
    Array.isArray(v) ? v.map((s: any) => ({ name: String((s && (s.name || s.segId)) || ''), count: Number(s && s.count) || 0 })).filter((s) => s.name) : []
  const recent: ActivityItem[] = Array.isArray(d.recentActivity)
    ? d.recentActivity.map((e: any) => ({ type: String((e && e.type) || ''), text: String((e && e.text) || ''), at: Number(e && e.at) || 0 })).filter((e) => e.text)
    : []
  return { cards, funnel, alerts, hot: seg(d.hot), stuck: seg(d.stuck), recent, approxSeg: !!(d.approx && d.approx.hot) }
}

// 手机号掩码（PII·根因#3 信任边界）：列表只显掩码，抽屉给操作员看完整号（联系买家/填面单）。
// 短号（<7 位·脏档/占位）原样返回，不假掩成 ****。
export function maskPhone(p: unknown): string {
  const s = String(p || '')
  return s.length >= 7 ? s.slice(0, 3) + '****' + s.slice(-4) : s
}

export interface OrderItemVM {
  productId: string
  name: string
  spec: string
  qty: number
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
  address: string // 列表用·手机号已掩码（PII）
  canShip: boolean // paid & 非金额异常 → 首次发货
  canModify: boolean // shipped → 改单号
  company: string // 当前物流公司（改单号预填）
  // —— 详情抽屉数据链（时间线/逐商品/交易号/微信合规·VMlhp）——
  items: OrderItemVM[]
  addrName: string
  addrPhone: string // 完整号（抽屉用·非列表）
  addrRegion: string
  addrDetail: string
  transactionId: string
  wxShipUploaded: boolean | null // 三态：true=已上报 / false=上报失败 / null=未知（未发货·别谎报未上传）
  createdAtMs: number | null
  paidAtMs: number | null
  shippedAtMs: number | null
  doneAtMs: number | null
}

const ms = (v: unknown): number | null => (typeof v === 'number' && v > 0 ? v : null)

export function mapOrderRows(list: unknown): OrderRowVM[] {
  if (!Array.isArray(list)) return []
  const out: OrderRowVM[] = []
  for (const o of list as Record<string, any>[]) {
    if (!o || typeof o !== 'object') continue
    const id = String(o.id || o._id || '')
    if (!id) continue
    const rawItems = Array.isArray(o.items) ? o.items : []
    const items: OrderItemVM[] = rawItems
      .filter((it: any) => it && typeof it === 'object')
      .map((it: any) => ({
        productId: String(it.productId || ''),
        name: String(it.name || ''),
        spec: String(it.spec || ''),
        qty: Number.isInteger(it.qty) && it.qty > 0 ? it.qty : 0,
      }))
    const names = items.map((it) => it.name).filter(Boolean)
    const a = o.address && typeof o.address === 'object' ? o.address : {}
    const status = String(o.status || '')
    out.push({
      id,
      status,
      statusLabel: orderStatusLabel(o.status),
      summary: names.slice(0, 2).join('、') + (names.length > 2 ? ` 等 ${names.length} 件商品` : ''),
      count: items.reduce((n, it) => n + it.qty, 0),
      amountLabel: yuan(o.amount) || '¥0.00',
      timeLabel: dateTime(o.createdAt),
      feeMismatch: o.feeMismatch === true,
      trackingNo: String((o.shipping && o.shipping.trackingNo) || o.trackingNo || ''),
      address: [a.name, maskPhone(a.phone), a.region, a.detail].filter(Boolean).join(' '), // 列表掩码
      canShip: status === 'paid' && o.feeMismatch !== true, // 金额不符单禁发货（云端也挡·这里只是入口收窄）
      canModify: status === 'shipped', // 已发货可改单号
      company: String((o.shipping && o.shipping.company) || ''),
      items,
      addrName: String(a.name || ''),
      addrPhone: String(a.phone || ''), // 完整·抽屉专用
      addrRegion: String(a.region || ''),
      addrDetail: String(a.detail || ''),
      transactionId: String(o.transactionId || ''),
      wxShipUploaded: typeof o.wxShipUploaded === 'boolean' ? o.wxShipUploaded : null,
      createdAtMs: ms(o.createdAt),
      paidAtMs: ms(o.paidAt),
      shippedAtMs: ms(o.shippedAt),
      doneAtMs: ms(o.doneAt),
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
  refundedAtLabel: string // 已退款单：到账时间（空=未退/无）
  rejectReason: string // 已拒绝单：拒绝原因（买家可见）
  // 买家收货人（换皮丢·审退款需识别申请人+联系寄回·后端 listRefunds join 订单地址）
  buyerName: string
  buyerPhone: string // 完整·抽屉用（联系买家）
  buyerMasked: string // 列表用·掩码（PII·根因#3）
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
      refundedAtLabel: a.refundedAt ? dateTime(a.refundedAt) : '', // 结果区：到账时间
      rejectReason: String(a.rejectReason || ''), // 结果区：拒绝原因
      buyerName: String(a.buyerName || ''),
      buyerPhone: String(a.buyerPhone || ''), // 全号·抽屉
      buyerMasked: maskPhone(a.buyerPhone), // 掩码·列表
    })
  }
  return out
}

export interface RefundVerdictVM {
  tone: 'ok' | 'lost'
  title: string
  sub: string
}

// 退款判据文案（P2·根因#8 判据不失真）：以「本单此行真实可退性 lineRefundable」（getRefundDetail 绑订单行·
// 与 approveRefund ENTERED_NOT_REFUNDABLE 同口径）为准，不被课程级激活（activation.entered）误导——买家可能经
// 别单/别码进过这门课，但本单此行仍可退，绝不显"会拦"。审核员据此判会不会被服务端拦。
export function refundVerdict(v: { lineRefundable: boolean; entered: boolean; refundableQty: number | null }): RefundVerdictVM {
  if (v.lineRefundable) {
    return {
      tone: 'ok',
      title: '本单此行仍可退',
      sub: v.entered
        ? '买家进过这门课，但本单此行未被撤退货权（进课撤的是别单/别码）——同意后服务端按当下订单行复核放行'
        : '未进课，符合退货规则——同意后服务端按当下订单行复核',
    }
  }
  return {
    tone: 'lost',
    title: '本单此行退货权已失',
    sub: '本单此行已被撤退货权（进课）——同意退款服务端会拦（ENTERED_NOT_REFUNDABLE）',
  }
}

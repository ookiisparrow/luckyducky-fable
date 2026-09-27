// 订单映射（纯函数：脏单归一防白屏/渲染访问点纵深防御/金额恒两位小数/
// 状态中文化）。
// 响应形状哨兵见 rewrite/cloud/tests/contract-shape.test.ts·cloud 改键该测试会红·同步时两头一起改。
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
  amountTitle: string // 金额行标题（付过钱=「实付款」/ 未付=「订单金额」·见下方 amountTitle()）
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

// 状态中文·客户向措辞（shared ORDER_STATUS 全集·未知状态回原串不冒充）。canonical 单源在
// rewrite/shared/src/statusLabels.ts 的 ORDER_STATUS_LABEL_CUSTOMER——mp 包进不了 @ldrw/shared（微信开发者
// 工具编译不出仓外引用，同 lib/checkoutConst.ts 头注），故手落此副本；措辞与 admin 运营向（同源
// ORDER_STATUS_LABEL_OPS，见 admin/src/lib/format.ts）刻意不同（如 shipped 这里「待收货」、admin「已发货」——
// 客户视角 vs 商家视角），不是漂移；状态码集合须与 shared 一致，由守卫 rw-mp-copies-synced 焊死。
const STATUS_LABELS: Record<string, string> = {
  pending: '待支付',
  paid: '待发货',
  shipped: '待收货',
  done: '已完成',
  closed: '已关闭',
  refund_required: '待退款', // PAID_BUT_OOS 死信（已付但缺货·待人工退款）·非「退款处理中」（与 admin 同口径，见 admin/src/lib/format.ts）
  payment_exception: '支付异常待处理',
}
export const statusLabel = (s: unknown): string => STATUS_LABELS[String(s)] || String(s || '')

// 金额行标题·顾客视角「这单钱付过没有」。**展示口径**，与 shared 的
// GMV/对账口径 PAID_ORDER_STATUSES 刻意不同：refund_required 是「已付但缺货、钱已收待人工退款」，
// GMV 不计入但顾客确实付过款，金额行须写「实付款」。反之 pending/closed 从未付过钱（状态机 closed 只从
// pending 转来），写「实付款」会让顾客以为被扣了钱。两个集合**穷举** shared ORDER_STATUS 全集（新增状态漏归类，
// 测试 orders-map「金额行标题」组当场红；不靠兜底默默吞掉）。
const PAID_LOOK = ['paid', 'shipped', 'done', 'refund_required', 'payment_exception']
const UNPAID_LOOK = ['pending', 'closed']
export const __amountTitleSets = { PAID_LOOK, UNPAID_LOOK } // 供测试核「两集合并起来=状态机全集」，不供页面用
/** 金额行标题：付过钱→「实付款」；未付/未知→「订单金额」（未知状态兜底按未付，不冒充已付）。 */
export const amountTitle = (s: unknown): string => (PAID_LOOK.includes(String(s)) ? '实付款' : '订单金额')

export const money = (v: unknown): string => {
  const n = Number(v)
  return Number.isFinite(n) ? '¥' + n.toFixed(2) : ''
}

/** 时间戳 → 'YYYY-MM-DD HH:mm'；非法返回空串。 */
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
    amountTitle: amountTitle(o.status),
    items: itemsOf(o),
    count: countOf(o),
    // 支付异常单展示实际到账：标题「实付款」不能配「订单标价」，否则对账/退款沟通依据错。
    // paidFee 为整数分（回调/补录落库），脏/缺回退订单金额。
    amountLabel:
      o.status === 'payment_exception' && Number.isInteger(Number(o.paidFee)) && Number(o.paidFee) > 0
        ? money(Number(o.paidFee) / 100) || '¥0.00'
        : money(o.amount) || '¥0.00',
    createdAtLabel: dateTime(o.createdAt),
    trackingNo: String(s.trackingNo || ''),
    shipCompany: String(s.company || ''),
    shippedAtLabel: dateTime(o.shippedAt),
    address: a ? { name: String(a.name || ''), phone: String(a.phone || ''), region: String(a.region || ''), detail: String(a.detail || '') } : null,
    goodsLabel: money(o.goods),
    shipLabel: Number(o.ship) > 0 ? money(o.ship) : '包邮',
    // 主线顾客页不展示优惠券：历史单可能仍带 coupon 快照，标签恒空，实付走库内 amount。
    couponLabel: '',
  }
}

/** 列表 → VM 列表（裸脏档整行剔除·不白屏）。 */
export function mapOrders(list: unknown): OrderVM[] {
  if (!Array.isArray(list)) return []
  return list.map(mapOrder).filter((x): x is OrderVM => !!x)
}

/** 「我」页订单格数字（v5 D1）：按状态拉一页算条数——一页内给实数，满页还有下一页给「N+」，取数失败给 ''（不显示，不瞎报 0）。
 *  ponytail: 没有顾客侧计数接口（订单 action 在红区），先用一页列表数；要精确大数就在云端加计数 action。 */
export function countBadge(r: { ok?: boolean; list?: unknown; hasMore?: unknown }, limit: number): string {
  if (!r || !r.ok || !Array.isArray(r.list)) return ''
  return r.hasMore && r.list.length >= limit ? `${limit}+` : String(r.list.length)
}

export type StepState = 'done' | 'cur' | 'todo'
const STEP_LABELS = ['下单', '付款', '发货', '收货']
// 各状态走到第几步（0 起）以及当前步是否已完成：done 状态四步全亮；关闭/未知只亮「下单」
const STEP_AT: Record<string, { at: number; finished: boolean }> = {
  pending: { at: 1, finished: false },
  paid: { at: 2, finished: false },
  shipped: { at: 3, finished: false },
  done: { at: 3, finished: true },
}

/** 订单进度四步（v5 订单详情）：完成＝墨、当前＝紫、未到＝灰（设计规范「进度/等级」）。 */
export function orderSteps(status: string): Array<{ label: string; state: StepState }> {
  const s = STEP_AT[status]
  return STEP_LABELS.map((label, i) => {
    if (!s) return { label, state: i === 0 ? 'done' : 'todo' }
    if (i < s.at || (i === s.at && s.finished)) return { label, state: 'done' }
    return { label, state: i === s.at ? 'cur' : 'todo' }
  })
}

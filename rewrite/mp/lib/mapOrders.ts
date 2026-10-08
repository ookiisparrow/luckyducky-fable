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
  reviewed: boolean // 这行已评价（云端订单接口读时附带 reviewedLineIds·没带＝当没评过，照旧出写评价）
}

export interface OrderVM {
  id: string
  status: string
  statusLabel: string
  amountTitle: string // 金额行标题（付过钱=「实付款」/ 未付=「订单金额」·见下方 amountTitle()）
  items: OrderLineVM[]
  count: number
  amountLabel: string
  createdAt: number // 下单时间戳（ms·脏/缺 0）：待支付倒计时起点（+ PAY_WINDOW_MS）
  createdAtLabel: string
  doneDateLabel: string // 确认收货日期 YYYY-MM-DD（云端 confirmReceive 写 doneAt·旧单无则空串）
  trackingNo: string
  shipCompany: string
  shippedAtLabel: string
  address: { name: string; phone: string; region: string; detail: string } | null
  goodsLabel: string
  shipLabel: string
  reviewedAll: boolean // 已完成且每行都评过：列表出灰底「已评价」、不出写评价
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
  payment_exception: '支付异常', // 标签是名词，「待处理」交给灯和说明句（UI 审查 15 问 6a·2026-09-30）
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
  const reviewed = new Set(Array.isArray(o.reviewedLineIds) ? o.reviewedLineIds.map(String) : [])
  const out: OrderLineVM[] = []
  for (const it of o.items) {
    if (!it || typeof it !== 'object') continue
    const lineId = String(it.lineId || it.productId || '')
    out.push({
      lineId,
      name: String(it.name || ''),
      spec: String(it.spec || ''),
      priceLabel: money(it.price),
      qty: Number.isInteger(it.qty) && it.qty > 0 ? it.qty : 0,
      enteredQty: Number.isInteger(it.enteredQty) && it.enteredQty > 0 ? it.enteredQty : 0, // 旧单无字段视 0
      refundable: it.refundable !== false,
      cover: String(it.cover || ''), // 旧单/搭配购无字段→空串（模板 wx:if 回退灰底占位·不裂图）
      reviewed: reviewed.has(lineId),
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
  const items = itemsOf(o)
  return {
    id,
    status: String(o.status || ''),
    statusLabel: statusLabel(o.status),
    amountTitle: amountTitle(o.status),
    items,
    count: countOf(o),
    // 支付异常单展示实际到账：标题「实付款」不能配「订单标价」，否则对账/退款沟通依据错。
    // paidFee 为整数分（回调/补录落库），脏/缺回退订单金额。
    amountLabel:
      o.status === 'payment_exception' && Number.isInteger(Number(o.paidFee)) && Number(o.paidFee) > 0
        ? money(Number(o.paidFee) / 100) || '¥0.00'
        : money(o.amount) || '¥0.00',
    createdAt: Number.isFinite(Number(o.createdAt)) && Number(o.createdAt) > 0 ? Number(o.createdAt) : 0,
    createdAtLabel: dateTime(o.createdAt),
    doneDateLabel: dateTime(o.doneAt).slice(0, 10),
    trackingNo: String(s.trackingNo || ''),
    shipCompany: String(s.company || ''),
    shippedAtLabel: dateTime(o.shippedAt),
    address: a ? { name: String(a.name || ''), phone: String(a.phone || ''), region: String(a.region || ''), detail: String(a.detail || '') } : null,
    goodsLabel: money(o.goods),
    shipLabel: Number(o.ship) > 0 ? money(o.ship) : '包邮',
    reviewedAll: o.status === 'done' && items.length > 0 && items.every((l) => l.reviewed),
  }
}

/** 列表 → VM 列表（裸脏档整行剔除·不白屏）。 */
export function mapOrders(list: unknown): OrderVM[] {
  if (!Array.isArray(list)) return []
  return list.map(mapOrder).filter((x): x is OrderVM => !!x)
}

/** 「我」页订单格数字（v5 D1·性能批 #1 改收云端 countMyOrders 的精确数）：上限内给实数，超上限给「N+」，
 *  取数失败（null/非数字/负数）给 ''（不显示，不瞎报 0）。 */
export function countBadge(n: unknown, cap: number): string {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return ''
  return n > cap ? `${cap}+` : String(n)
}

export type StepState = 'done' | 'cur' | 'todo'
const STEP_LABELS = ['下单', '付款', '发货', '收货']
// 各状态「已走到的最后一步」下标（设计稿 logic sN）：进行中（待支付/待发货/待收货）那一步亮紫＝当前，
// 其余走过的实心黑；完成四步全黑；待退款/支付异常钱付过→前两步黑、不亮紫；关闭/未知只亮「下单」。
const STEP_AT: Record<string, number> = { pending: 0, paid: 1, shipped: 2, done: 3, closed: 0, refund_required: 1, payment_exception: 1 }
const LIVE = ['pending', 'paid', 'shipped']

/** 订单进度四步（v5 订单详情）：完成＝墨、当前＝紫、未到＝灰（设计稿 B2 steps）。
 *  refunded＝整单退完：订单到此结束，走过的步之后接「退款」、全墨（老板 2026-10-03）。 */
export function orderSteps(status: string, refunded = false): Array<{ label: string; state: StepState }> {
  const at = STEP_AT[status] ?? 0
  if (refunded) return [...STEP_LABELS.slice(0, at + 1), '退款'].map((label) => ({ label, state: 'done' }))
  const live = LIVE.includes(status)
  return STEP_LABELS.map((label, i) => ({ label, state: live && i === at ? 'cur' : i <= at ? 'done' : 'todo' }))
}

// 支付窗口（镜像 rewrite/shared/src/limits.ts PAY_WINDOW_MS·mp 进不了 @ldrw/shared；测试 orders-map 核同值）。
// 只用于展示倒计时，真正关单由云端 closeExpiredOrders / pay 惰性关单裁决。
export const PAY_WINDOW_MS = 15 * 60 * 1000
const pad2 = (n: number) => String(n).padStart(2, '0')
/** 待支付剩余 ms（缺下单时间回 -1＝不显示倒计时）；过点钳 0，不倒负。 */
export const payLeftMs = (vm: OrderVM, now: number): number => (vm.createdAt ? Math.max(0, vm.createdAt + PAY_WINDOW_MS - now) : -1)
export const mmss = (ms: number): string => {
  const s = Math.floor(ms / 1000)
  return pad2(Math.floor(s / 60)) + ':' + pad2(s % 60)
}

/** 卡片/状态卡上的状态名：与筛选标签、详情完全同名（UI 审查 15 问 6a·2026-09-30：同一张单在任何地方叫同一个名字）。 */
export const cardLabel = (s: string): string => statusLabel(s)

// 状态灯（UI 审查 15 问 6a·2026-09-30）：颜色只落在灯上——黄＝等你（待支付/待退款）、红＝出错（支付异常·唯一用红的状态）、
// 墨点＝进行中（待发货/待收货）；已完成/已关闭/已超时/已退款＝灰圈无光晕。其余带同色光晕（px-i halo 默认）。
const LED: Record<string, string> = { pending: 'var(--v5-warn)', paid: 'var(--v5-ink)', shipped: 'var(--v5-ink)', refund_required: 'var(--v5-warn)', payment_exception: 'var(--v5-err)' }
export const GREY_LED = { tone: 'rgba(17,17,17,.28)', halo: 'none' }
export function orderLed(status: string): { tone: string; halo: string } {
  const tone = LED[status]
  return tone ? { tone, halo: '' } : GREY_LED
}

/** 状态名 + 灯（列表卡与详情状态卡共用）：待支付过点＝「已超时」灰圈（终态不是错误·不用红）。 */
export function statusHead(vm: OrderVM, now: number): { label: string; led: { tone: string; halo: string } } {
  if (vm.status === 'pending' && payLeftMs(vm, now) === 0) return { label: '已超时', led: GREY_LED }
  return { label: cardLabel(vm.status), led: orderLed(vm.status) }
}

// 'YYYY-MM-DD' → 'M月D日'（签收日期短写）
const md = (ymd: string): string => {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(ymd)
  return m ? `${Number(m[1])}月${Number(m[2])}日` : ymd // 黑体（显示在 .t-sys 节点）
}

/** 订单卡右上角（设计稿 oview.right）：待支付给倒计时 cd，其余给小字 text。 */
export function listRight(vm: OrderVM, now: number): { cd: string; text: string } {
  if (vm.status === 'pending') {
    const left = payLeftMs(vm, now)
    if (left === 0) return { cd: '', text: '未按时支付' } // 黑体·过点：状态名换「已超时」（statusHead），不停在 00:00
    return { cd: left < 0 ? '' : mmss(left), text: '' }
  }
  // 列表右侧 ≤8 字短句，与详情说明句说同一件事（UI 审查 15 问 6a·2026-09-30）
  const text: Record<string, string> = {
    paid: '48 小时内发货',
    shipped: vm.shipCompany ? vm.shipCompany + ' · 派送中' : '派送中',
    done: vm.doneDateLabel ? md(vm.doneDateLabel) + ' 签收' : vm.createdAtLabel,
    closed: '已取消或超时',
    refund_required: '客服处理中',
    payment_exception: '请联系客服',
  }
  return { cd: '', text: text[vm.status] ?? vm.createdAtLabel }
}

/** 详情状态卡说明句（完整一句·一律灰字；只有待支付倒计时是深黄）（UI 审查 15 问 6a·2026-09-30）。
 *  不承诺时效（老板 2026-09-30：待退款/审核/到账都不写时限）；没有数据源的不编（预计送达）。 */
export function detailSub(vm: OrderVM, now: number): { text: string; tone: '' | 'warn' | 'err' } {
  switch (vm.status) {
    case 'pending': {
      const left = payLeftMs(vm, now)
      if (left < 0) return { text: '', tone: '' }
      if (left === 0) return { text: `${PAY_WINDOW_MS / 60_000} 分钟内未支付，订单已关闭`, tone: '' } // 黑体（显示在 .t-sys 节点）
      return { text: mmss(left) + ' 后自动取消，请尽快支付', tone: 'warn' } // 黑体（显示在 .t-sys 节点）
    }
    case 'paid':
      return { text: '商家会在 48 小时内发货', tone: '' }
    case 'shipped':
      return { text: vm.shipCompany ? vm.shipCompany + ' · 派送中' : '', tone: '' } // 预计送达没有数据源，不编
    case 'done':
      return { text: vm.doneDateLabel ? md(vm.doneDateLabel) + ' 已签收' : '', tone: '' }
    case 'closed':
      return { text: '订单已取消或超时未支付', tone: '' }
    case 'refund_required':
      return { text: '需人工退款，请联系客服处理', tone: '' }
    case 'payment_exception':
      return { text: '到账金额与订单金额不一致，请联系客服处理', tone: '' } // 黑体（显示在 .t-sys 节点）
    default:
      return { text: '', tone: '' }
  }
}

/** 写评价页地址（订单列表单件直达 / 详情逐件）：每段都 URL 编码（review.ts onLoad 逐个 decode）——
 *  lineId 可能含 &/#（productId 拼规格），未编码会截断查询串。 */
export function reviewUrl(orderId: string, line: { lineId: string; name: string; spec: string; cover: string }): string {
  const q = (v: string) => encodeURIComponent(v || '')
  return `/pages/review/review?orderId=${q(orderId)}&lineId=${q(line.lineId)}&name=${q(line.name)}&spec=${q(line.spec)}&cover=${q(line.cover)}`
}

// 「不完整」标记：capped / truncated＝读到条数上限就停了，列表或由它算出的数只覆盖前 N 条；approx＝按样本估的近似数；partial＝有一路读失败、缺了那一路，不能当 0 或全清。
// 消费方见到任一个都要向人说明；四个名字不统一但不改，因小程序/后台与云端分开发版，改名会让线上旧客户端读不到。
// mp↔cloud 响应契约（病根#5 手抄副本漂移 + #8 编译绿≠契约没漂）。
// 为什么存在：mp 物理进不了 @ldrw/shared（微信开发者工具编译不出仓外引用·rewrite/mp/lib/mapOrders.ts
// 头注等自证），响应形状全靠手抄——cloud 改键 mp 编译不红＝静默漂移面。本文件＝cloud 侧编译锚
// （handler 返回类型绑定）+ mp 手抄副本的人类正本；机器哨兵＝rewrite/cloud/tests/contract-shape.test.ts
// （键集合 Object.keys 排序全等·增删都红）。哨兵红了先同步 mp 消费面四点位——
// rewrite/mp/lib/payFlow.ts（收银台五参）/ lib/mapOrders.ts（订单文档）/ lib/playbackCache.ts（r.url）/
// pages/order-list/order-list.ts（nextCursor/hasMore）——再改本文件与哨兵测试。
// 纯类型零运行时：只 export type/interface，不 export 值（esbuild 内联零产物影响）。
// 订单文档形状与库内文档同一份（order.ts OrderDoc）：响应就是库里读出来的单。
import type { OrderDoc, AfterSaleDoc } from './order'
import type { AnomalyKind, AnomalySeverity, InspectRunRecord } from './observability'
import type { BomTemplate } from './scmBom'

/** 成功包：{ ok:true, ...data } 整包展开（kit/reply.ts ok() 无 data 信封）。 */
type AppOk<T> = { ok: true } & T
/** 失败包：恒含 ok/error 两键；extra 动态键（如 CODE_TAKEN 带 courseId）刻意不建模——锁了拦创新。 */
type AppErr = { ok: false; error: string }
type AppResp<T> = AppOk<T> | AppErr

/** wx.requestPayment 收银台五参（mp 消费面：payFlow.ts PaymentParams 手抄副本）。 */
interface WxPaymentParams {
  timeStamp: string
  nonceStr: string
  package: string
  signType: string
  paySign: string
}

/** createOrder 入参（mp api/orders.ts 手抄）。全是不可信输入、云端逐个校验，类型只锁键名。 */
export interface CreateOrderReq {
  items?: unknown
  address?: unknown
  idempotencyKey?: unknown
  /** 结算页显示的应付总额（整数分）。与云端现价应付不符回 PRICE_CHANGED（带 amountFen）；不传不核对。 */
  expectedAmountFen?: unknown
}

// ── 五个热 action 的响应契约（钱链×4 + 学习链×1）──
export type CreateOrderResp = AppResp<{ order: OrderDoc }>
/** pay 双分支：0 元直付 {paid,paidAt}（paid 写 boolean 不写字面量 true——ok() 泛型推断会宽化）| 收银台 {payment}。 */
export type PayResp = AppResp<{ paid: boolean; paidAt: number } | { payment: WxPaymentParams }>
/** 订单读响应＝库内文档 + 读时附加的已评价行 lineId（只读评价集合·不在订单文档里；评价读失败时不带该键）。 */
export type OrderRead = OrderDoc & { reviewedLineIds?: string[] }
/** withAfterSales 时多带本人最近 100 条售后（订单列表叠加「售后中/已退款」·省一次往返）；售后读失败不带该键。 */
export type GetMyOrdersResp = AppResp<{ list: OrderRead[]; nextCursor: unknown; hasMore: boolean; afterSales?: AfterSaleDoc[] }>
export type GetOrderByIdResp = AppResp<{ order: OrderRead }>
/** 「我」页订单格数字：三态精确数；单态 count 失败给 null（那格不显示数字）。 */
export type CountMyOrdersResp = AppResp<{ counts: { pending: number | null; paid: number | null; shipped: number | null } }>
/** 我的课 + 学习进度一次往返；进度读失败给 null（课卡照出、进度标「读不到」）。 */
export type GetMyLearningResp = AppResp<{ courses: { courseId: string; enteredAt: number }[]; progress: unknown[] | null }>
/** 退款试算：预计退款额，分整数（与 applyRefund 同一份算额）。 */
export type EstimateRefundResp = AppResp<{ refundFen: number }>
export type GetPlaybackUrlResp = AppResp<{ url: string | null }>

// ── 后台 adminApi 钱链 action 的成功包字段（admin api/money.ts 用；失败包与 ok/status 由 admin client 统一建模）──
// 键与单位的真源是 tests/contracts/admin-money.json（云端测试对着真 adminApi 锁）；那边变了，这里跟着改。
// 发货两项与越规退款不在那份契约里，照 adminApi actions/orders.ts、refunds.ts 的回包写。

/** pageQuery 游标分页。 */
interface AdminPage<T> {
  list: T[]
  nextCursor: unknown
  hasMore: boolean
}
/** listOrders 的单：库内文档 + 发货闸标记（与 shipOne 同一判据）。 */
interface AdminOrderRow extends OrderDoc {
  /** 有在途售后或每行都退够件数：不能发货。 */
  refundHold: boolean
  /** 每行已退件数，键是 lineId（旧单 productId）。 */
  refundedQty: Record<string, number>
}
/** listRefunds 的售后单：库内文档 + 从订单 join 的收货人。 */
interface AdminRefundRow extends AfterSaleDoc {
  buyerName: string
  buyerPhone: string
}
/** 买家对某商品所属课程的激活态。 */
export interface AdminActivation {
  courseId: string
  activated: boolean
  entered: boolean
  code: string
  enteredAt: number | null
}

export type AdminOrdersPage = AdminPage<AdminOrderRow>
export type AdminRefundsPage = AdminPage<AdminRefundRow>
/** orderCounts / refundCounts：各状态 + all 的精确计数；partial＝有一路 count 失败，数字不可信。 */
export interface AdminStatusCounts {
  counts: Record<string, number>
  partial: boolean
}
/** getOrderDetail：键是 productId。 */
export interface AdminOrderDetail {
  activations: Record<string, AdminActivation>
}
/** getRefundDetail：lineRefundable 绑本单这一行（非课程级）；refundableQty 行缺失时为 null。 */
export interface AdminRefundDetail {
  activation: AdminActivation
  lineRefundable: boolean
  refundableQty: number | null
  lineFound: boolean
}
/** shipOrder 成功：wxShip＝微信发货信息是否上报成功。 */
export interface AdminShipped {
  wxShip: boolean
  refundedQty: Record<string, number>
}
/** shipOrders：逐单独立，整包 ok 不代表每单都发出去了。 */
export interface AdminShipBatch {
  okCount: number
  failCount: number
  results: Array<{ id: string; ok: boolean; error?: string }>
}
/** overrideRefund：新建售后单的 _id。 */
export interface AdminOverrideRefund {
  id: string
}
/** getDashboard。gmv 是元；txAlerts.partial＝钱链异常有一路没查到，三类列表可能不全。 */
export interface AdminDashboard {
  stats: { users: number; orders: number; gmv: number; codesTotal: number; codesActivated: number; learners: number }
  /** toShip：待发货扫描触顶，toShip 数只是下限。 */
  approx: { gmv: boolean; hot: boolean; stuck: boolean; sampleSize: number; toShip: boolean }
  funnel: { ordered: number; paid: number; activated: number }
  /** 真能发的单数（paid、无金额不符、不被退款拦，与 shipOne 同判据）。 */
  toShip: number
  txAlerts: { feeMismatch: string[]; refundMismatch: string[]; stuckRefunds: string[]; partial: boolean }
  hot: Array<{ segId: string; name: string; count: number }>
  stuck: Array<{ segId: string; name: string; count: number }>
  recentActivity: Array<{ type: string; at: number; text: string }>
}

// ── 后台商品组 action 的成功包字段（admin api/products.ts 用）──
// 这组没有契约 JSON 锁，照 adminApi actions/products.ts、cards.ts 与 catalog.ts storeImage 的回包写。

/** listDrafts：最新 100 个商品草稿（库内文档原样，字段不在这里建模）。urls：图片 fileID → 临时地址，换不到的不在里面。
 *  listed、cardFinal 键是商品 id；hasVideo、coursePublished、hasBatch 键是课程 id。 */
export interface AdminDrafts {
  list: Array<Record<string, unknown>>
  urls: Record<string, string>
  listed: Record<string, boolean>
  cardFinal: Record<string, boolean>
  hasVideo: Record<string, boolean>
  coursePublished: Record<string, boolean>
  hasBatch: Record<string, boolean>
}
/** listShowcase：products 集合按 sort 排的前 100 个（库内文档原样）+ 封面临时地址。 */
export interface AdminShowcase {
  list: Array<Record<string, unknown>>
  urls: Record<string, string>
}
/** 卡面档：saveCard 按这个形状清洗后写库。 */
export interface AdminCardDoc {
  productId: string
  courseId: string
  name: string
  status: 'draft' | 'final'
  front: { art: string; bg: string; showBrand: boolean }
  back: { bg: string; brandText: string; texts: { title: string; sub: string; scanHint: string; warning: string } }
  sizeMM: { w: number; h: number }
}
/** getCard：没建过卡时 card 是 null；artUrl 是正面图的临时地址（不是云存储图或换不到时为 ''）。 */
export interface AdminCard {
  card: AdminCardDoc | null
  artUrl: string
}
/** uploadImage：fileID 写进档里，url 是给页面预览的临时地址（换不到为 ''）。 */
export interface AdminUploaded {
  fileID: string
  url: string
}

// ── 后台其余 action 的成功包字段（admin api/content、cs、ops、reviews、scm、system 用）──
// 照 rewrite/cloud/src/functions/adminApi/actions/ 同名 action 的回包写；「库内文档原样」的列表不建模字段。
// 失败包随错误码带回的上下文一般不建模；页面要读的（如 DRAFT_CONFLICT 带 rev）写在 typedPost 第二个类型参数里。

/** 库内文档原样回给页面（字段不在这里建模）。 */
type RawDoc = Record<string, unknown>

// content / courses
/** getHomeContent：content/home 整档，没建过为 null。 */
export interface AdminHomeContent {
  home: RawDoc | null
}
/** getPageContent：content/<page> 整档，没建过为 null。 */
export interface AdminPageContent {
  page: string
  content: RawDoc | null
}
/** listHelpVideos：rev 是乐观并发基线，缺档为 0。 */
export interface AdminHelpVideos {
  items: unknown[]
  rev: number
}
/** 写后的版本号（乐观并发基线）。 */
export interface AdminRev {
  rev: number
}
/** getCourseDraft：先读草稿，没有再读已发布（fromPublished），都没有 course 为 null。 */
export interface AdminCourseDraft {
  course: RawDoc | null
  fromPublished?: true
}
/** syncVodMedia：本次回写就绪的段数 / 仍在转码的段数。 */
export interface AdminVodSynced {
  ready: number
  processing: number
  rev: number
}
/** getVodUploadSignature。 */
export interface AdminVodSignature {
  signature: string
}
/** getVideoUploadMeta：云存储 POST 表单直传凭证。 */
export interface AdminVideoUploadMeta {
  url: string
  token: string
  authorization: string
  fileId: string
  cosFileId: string
}

// cs
interface AdminConversationMsg {
  id: string
  channel: string
  /** 'in' 客户 · 'out' 客服/机器人 */
  direction: string
  openid: string
  externalUserId: string
  msgtype: string
  text: string
  at: number | null
}
/** searchConversations：keyword 只滤本页，翻页照原始页续。 */
export interface AdminConversations {
  messages: AdminConversationMsg[]
  count: number
  nextCursor: unknown
  hasMore: boolean
}
/** conversationsReport：最近 sampleSize 条消息的样本；slaMs 是本次实际生效阈值。 */
export interface AdminConversationsReport {
  sampleSize: number
  approx: boolean
  slaMs: number
  volume: { messages: number; inbound: number; outbound: number; customers: number }
  response: { avgResponseMs: number; maxResponseMs: number; answered: number; unanswered: number; answeredRate: number }
  sla: { slaMs: number; breaches: number; breachRate: number; unanswered: number }
}
/** getCustomer360：单面板取数失败只标该面板 error，data 为 null。 */
export interface AdminCustomer360 {
  openid: string
  panels: Array<{ key: string; label: string; order: number; data: unknown; error?: string }>
}
/** getUser：查无此人时 user 为 null（不算失败）。 */
export interface AdminUser {
  user: {
    openid: string
    nickname: string
    avatar: string
    phone: string
    bio: string
    createdAt: number | null
    updatedAt: number | null
  } | null
}
/** searchCustomer：matchedBy 是命中的键（openid/phone/nickname/orderId）。 */
export interface AdminCustomerHits {
  count: number
  customers: Array<{ openid: string; nickname: string; phone: string; avatar: string; createdAt: number | null; matchedBy: string[] }>
}
export interface AdminKb {
  list: Array<{ key: string; question: string; answer: string; category: string; enabled: boolean; order: number; featured: boolean }>
}
/** saveKb / saveCheckpoints：保存后的条数。 */
export interface AdminSavedCount {
  count: number
}
/** getCsatReport：dist 键是 1-5 分。 */
export interface AdminCsatReport {
  total: number
  avg: number
  dist: Record<number, number>
  withNote: number
  approx: boolean
}
export interface AdminCsatEntries {
  entries: Array<{ id: string; at: number; score: number; note: string; externalUserId: string }>
  nextCursor: unknown
  hasMore: boolean
}
/** listCheckpoints：rev 是该课元档版本号（不传 courseId 时为 0）。 */
export interface AdminCheckpoints {
  list: Array<{ courseId: string; nodeId: string; title: string; remedy: string; order: number }>
  rev: number
}
/** 质检抽样行：sessionKey 是 csSession._id；该客户消息聚合读失败时不带 messageCount/avgResponseMs。 */
interface AdminQcRow {
  sessionKey: string
  externalUserId: string
  updatedAt: number
  qcSampledAt: number
  messageCount?: number
  avgResponseMs?: number
}
export interface AdminQcSampled {
  sampled: AdminQcRow[]
  count: number
}
export type AdminQcList = AdminPage<AdminQcRow & { qc: { score: number; note: string; by: string; at: number } | null }>
export interface AdminTrialRefreshGate {
  enabled: boolean
}
/** refreshTrialSession：逐个目标的结果。 */
export interface AdminTrialRefreshed {
  results: Array<
    | { ok: true; externalUserId: string; epochFrom: number; epochTo: number; forced: boolean }
    | { ok: false; error: 'TRIAL_ONLY' | 'HUMAN_ACTIVE' | 'BAD_ARGS'; externalUserId?: string }
  >
}

// ops
/** 异常账本一条（kit/anomaly.ts recordAnomaly 写）。 */
export interface AdminAnomaly {
  _id: string
  kind: AnomalyKind
  code: string
  severity: AnomalySeverity
  ctx: Record<string, unknown>
  count: number
  firstSeen: number
  lastSeen: number
  resolved: boolean
  resolvedAt?: number
  resolvedBy?: string
}
export interface AdminInspectRun {
  run: InspectRunRecord
}
/** getInspectStatus：一次都没巡检过时 latest 为 null。 */
export interface AdminInspectStatus {
  latest: InspectRunRecord | null
  openAnomalies: number
}
/** listAnomalies：total 是同条件全量数（读失败为 null），list 受 limit 截断。 */
export interface AdminAnomalies {
  list: AdminAnomaly[]
  limit: number
  total: number | null
}
/** resolveAnomaly：没改到（id 不存在或写失败）时 ok:false 且不带 error。 */
export interface AdminAnomalyResolved {
  id: string
}
/** listAudit：summary 是写侧已剥敏感字段的入参摘要。 */
export interface AdminAuditPage {
  entries: Array<{ id: string; action: string; operator: string; ip: string; ok: boolean; error: string; summary: Record<string, unknown>; ts: number }>
  nextCursor: unknown
  hasMore: boolean
}

// reviews
/** listReviews：photos 是已换好的临时地址（换不到的已剔除）。 */
export type AdminReviewsPage = AdminPage<{
  id: string
  productId: string
  orderId: string
  name: string
  rating: number
  tags: string[]
  text: string
  spec: string
  createdAt: number
  photos: string[]
  picked: boolean
}>
export interface AdminReviewPicked {
  picked: boolean
}

// scm
/** listMaterials：物料主档库内文档原样。 */
export interface AdminMaterials {
  list: RawDoc[]
}
/** listSuppliers / listLedger / listPurchases / listOutworks / listAssemblies：库内文档原样分页。 */
export type AdminDocPage = AdminPage<RawDoc>
export interface AdminMaterialSaved {
  materialId: string
}
export interface AdminSupplierSaved {
  supplierId: string
}
/** adjustStock / issueOutwork：实际落账的流水条数（幂等重放为 0）。 */
export interface AdminStockApplied {
  applied: number
}
/** savePurchase：totalFen 是服务端按行核算的总价（分）。 */
export interface AdminPurchaseSaved {
  purchaseId: string
  totalFen: number
}
/** 状态流转类（markOrdered / cancel* / settleOutwork）：moved=false 表示单已是目标状态（重放，不算失败）。 */
export interface AdminMoved {
  moved: boolean
}
/** receivePurchase：已入过库时 moved=false 且不带 applied。 */
export interface AdminPurchaseReceived {
  moved: boolean
  applied?: number
}
export interface AdminOutworkSaved {
  outworkId: string
}
/** receiveOutwork：应付工钱（分）与定格的损耗团数。 */
export interface AdminOutworkReceived {
  payableFen: number
  lossQty: number
  applied: number
}
/** getBomSetup：没建过模板时 template 为 null；profiles 是 bomProfiles 库内文档原样。 */
export interface AdminBomSetup {
  template: BomTemplate | null
  profiles: RawDoc[]
}
export interface AdminBomProfileSaved {
  productId: string
}
/** 预演/缺口行：missing＝料号没建档（库存按 0 算）。 */
interface AdminMaterialNeed {
  materialId: string
  name: string
  uom: string
  need: number
  stock: number
  missing: boolean
}
export interface AdminAssemblyPreview {
  lines: Array<AdminMaterialNeed & { short: number }>
}
export interface AdminAssembled {
  sets: number
  consumed: Array<{ materialId: string; qty: number }>
}
/** getRestockPlan：带结团缺口走外协（rawToIssue＝应发同色 L 原团），其余按供应商分组采购。 */
export interface AdminRestockPlan {
  outworkGaps: Array<{ color: string; knottedNeed: number; knottedStock: number; gap: number; rawToIssue: number }>
  purchaseGroups: Array<{ supplierId: string; supplierName: string; lines: Array<AdminMaterialNeed & { gap: number }> }>
  missingMaterials: string[]
}
/** getFgSummary：打包 / 发货累计（发货已转正数）。 */
export interface AdminFgSummary {
  packed: Array<{ productId: string; spec: string; qty: number }>
  shipped: Array<{ productId: string; spec: string; qty: number }>
  truncated: boolean
}
/** getScmOverview：truncated 只在应付扫描触顶时出现。 */
export interface AdminScmOverview {
  lowStock: Array<{ materialId: string; name: string; uomLabel: string; qty: number; threshold: number; gap: number; suggest: 'outwork' | 'purchase' }>
  payables: Array<{ supplierId: string; name: string; payableFen: number; orderCount: number }>
  payableTotalFen: number
  truncated?: true
  inTransit: { purchaseCount: number; outworkCount: number }
  recentLedger: Array<{ _id: string; itemKey: string; delta: number; docType: string; docId: string; operator: string; reason: string; at: number }>
}

// system
export interface AdminAgents {
  agents: Array<{
    id: string
    name: string
    role: string
    disabled: boolean
    createdAt: number | null
    wecomUserId: string
    /** agentState 没档时为 'offline' */
    status: string
    stateUpdatedAt: number | null
    activeCount: number
    todayClosed: number
  }>
}
export interface AdminAgentCreated {
  agent: { id: string; name: string; role: string; disabled: boolean; wecomUserId: string }
}
export interface AdminAgentDisabled {
  id: string
  disabled: boolean
}
export interface AdminAgentWecomBound {
  id: string
  wecomUserId: string
}
/** listBatches：扫描触顶时 truncated，批次统计可能不全。 */
export interface AdminBatches {
  list: Array<{ batchId: string; total: number; activated: number; createdAt: number }>
  truncated: boolean
}
export interface AdminBatchCreated {
  batchId: string
  codes: string[]
}
export interface AdminBatchCodes {
  codes: string[]
  nextCursor: unknown
  hasMore: boolean
}
/** getSettings：webhook 原值不出云端，只回配了没 + 尾号；没建过设置时为 {}。 */
export interface AdminSettings {
  settings: {
    _id?: string
    urlPrefix?: string
    alertEvents?: Record<string, boolean>
    updatedAt?: number
    alertWebhookSet?: true
    alertWebhookTail?: string
  }
}
/** 配置清单一项：带 fill 的可在后台直接填写保存（响应从不回显已存值）。 */
export interface AdminChecklistItem {
  key: string
  name: string
  location: string
  purpose: string
  status: 'ok' | 'missing' | 'check'
  howTo: string
  url: string
  noteExtra?: string
  fill?: {
    action: 'saveSecureConfig' | 'savePayConfig'
    /** 只有 saveSecureConfig 用 */
    docId?: 'wxkf' | 'wxpay' | 'vod'
    field: string
    inputType: 'text' | 'password' | 'textarea' | 'select'
    options?: { value: string; label: string }[]
  }
}
export interface AdminChecklistGroup {
  group: string
  items: AdminChecklistItem[]
}
export interface AdminConfigChecklist {
  groups: AdminChecklistGroup[]
}
/** getReconciliation：金额是元；cumulative 是全量累计，summary/daily 是所选区间；exceptions 同看板钱链告警。 */
export interface AdminReconciliation {
  range: { from: string; to: string }
  partial: boolean
  cumulative: { income: number; refund: number; net: number }
  summary: { income: number; refund: number; net: number; orders: number; refunds: number }
  daily: Array<{ day: string; income: number; refund: number; net: number; orders: number; refunds: number }>
  approx: boolean
  exceptions: AdminDashboard['txAlerts']
}
/** getBillMatch：金额是元；oursOnly 只在该日账单已拉过时才判。 */
export interface AdminBillMatch {
  range: { from: string; to: string }
  summary: { matched: number; wxOnly: number; oursOnly: number; amountMismatch: number }
  discrepancies: {
    wxOnly: Array<{ transactionId: string; outTradeNo: string; amount: number; date?: string }>
    oursOnly: Array<{ id: string; transactionId: string; amount: number; paidAt: number }>
    amountMismatch: Array<{ id: string; transactionId: string; ourAmount: number; wxAmount: number }>
  }
  billDays: string[]
  approx: boolean
}
export interface AdminBillDownloaded {
  date: string
  count: number
}
/** listInventory：扫描触顶时 truncated。 */
export interface AdminInventory {
  list: RawDoc[]
  truncated: boolean
}

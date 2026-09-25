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

// ── 五个热 action 的响应契约（钱链×4 + 学习链×1）──
export type CreateOrderResp = AppResp<{ order: OrderDoc }>
/** pay 双分支：0 元直付 {paid,paidAt}（paid 写 boolean 不写字面量 true——ok() 泛型推断会宽化）| 收银台 {payment}。 */
export type PayResp = AppResp<{ paid: boolean; paidAt: number } | { payment: WxPaymentParams }>
export type GetMyOrdersResp = AppResp<{ list: OrderDoc[]; nextCursor: unknown; hasMore: boolean }>
export type GetOrderByIdResp = AppResp<{ order: OrderDoc }>
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
export interface AdminOrderRow extends OrderDoc {
  /** 有在途售后或每行都退够件数：不能发货。 */
  refundHold: boolean
  /** 每行已退件数，键是 lineId（旧单 productId）。 */
  refundedQty: Record<string, number>
}
/** listRefunds 的售后单：库内文档 + 从订单 join 的收货人。 */
export interface AdminRefundRow extends AfterSaleDoc {
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
  approx: { gmv: boolean; hot: boolean; stuck: boolean; sampleSize: number }
  funnel: { ordered: number; paid: number; activated: number }
  /** 真能发的单数（paid、无金额不符、不被退款拦，与 shipOne 同判据）。 */
  toShip: number
  txAlerts: { feeMismatch: string[]; refundMismatch: string[]; stuckRefunds: string[]; partial: boolean }
  hot: Array<{ segId: string; name: string; count: number }>
  stuck: Array<{ segId: string; name: string; count: number }>
  recentActivity: Array<{ type: string; at: number; text: string }>
}

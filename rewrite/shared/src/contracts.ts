// mp↔cloud 响应契约（批B10·病根#5 手抄副本漂移 + #8 编译绿≠契约没漂）。
// 为什么存在：mp 物理进不了 @ldrw/shared（微信开发者工具编译不出仓外引用·rewrite/mp/lib/mapOrders.ts
// 头注等自证），响应形状全靠手抄——cloud 改键 mp 编译不红＝静默漂移面。本文件＝cloud 侧编译锚
// （handler 返回类型绑定）+ mp 手抄副本的人类正本；机器哨兵＝rewrite/cloud/tests/contract-shape.test.ts
// （键集合 Object.keys 排序全等·增删都红）。哨兵红了先同步 mp 消费面四点位——
// rewrite/mp/lib/payFlow.ts（收银台五参）/ lib/mapOrders.ts（订单文档）/ lib/playbackCache.ts（r.url）/
// pages/order-list/order-list.ts（nextCursor/hasMore）——再改本文件与哨兵测试。
// 纯类型零运行时：只 export type/interface，不 export 值（esbuild 内联零产物影响）。

/** 成功包：{ ok:true, ...data } 整包展开（kit/reply.ts ok() 无 data 信封）。 */
export type AppOk<T> = { ok: true } & T
/** 失败包：恒含 ok/error 两键；extra 动态键（如 CODE_TAKEN 带 courseId）刻意不建模——锁了拦创新。 */
export type AppErr = { ok: false; error: string }
export type AppResp<T> = AppOk<T> | AppErr

/** 订单地址快照（createOrder 白名单四要素）。 */
export interface AppOrderAddress {
  name: string
  phone: string
  region: string
  detail: string
}

/** 订单行（下单快照·9 键）。price 单位「元」——库记元、运算走分（orders.ts 金额注释）。 */
export interface AppOrderLine {
  productId: string
  lineId: string
  name: string
  spec: string
  price: number
  qty: number
  enteredQty: number
  refundable: boolean
  cover: string
}

/**
 * 订单文档：基础 12 键 + 生命周期可选键。paidAt 是 payMode 条件键（mock 建单即有、real 支付后才有——
 * 两条路径哨兵各锁一例）；paidAt 之外的生命周期键由 callbacks/adminApi 写入，第一批仅类型登记、
 * 不进键集合断言（锁它们要造全生命周期夹具＝脆而无谓）；mp mapOrders 消费 shipping/shippedAt。
 */
export interface AppOrderDoc {
  _id: string
  id: string
  _openid: string
  items: AppOrderLine[]
  goods: number
  coupon: number
  ship: number
  amount: number
  address: AppOrderAddress
  reserved: { productId: string; spec: string; qty: number }[]
  status: string
  createdAt: number
  paidAt?: number
  closedAt?: number
  doneAt?: number
  shippedAt?: number
  shipping?: { company: string; trackingNo: string }
  cancelledBy?: string
  entVer?: number
}

/** wx.requestPayment 收银台五参（mp 消费面：payFlow.ts PaymentParams 手抄副本）。 */
export interface WxPaymentParams {
  timeStamp: string
  nonceStr: string
  package: string
  signType: string
  paySign: string
}

// ── 五个热 action 的响应契约（钱链×4 + 学习链×1）──
export type CreateOrderResp = AppResp<{ order: AppOrderDoc }>
/** pay 双分支：0 元直付 {paid,paidAt}（paid 写 boolean 不写字面量 true——ok() 泛型推断会宽化）| 收银台 {payment}。 */
export type PayResp = AppResp<{ paid: boolean; paidAt: number } | { payment: WxPaymentParams }>
export type GetMyOrdersResp = AppResp<{ list: AppOrderDoc[]; nextCursor: unknown; hasMore: boolean }>
export type GetOrderByIdResp = AppResp<{ order: AppOrderDoc }>
export type GetPlaybackUrlResp = AppResp<{ url: string | null }>

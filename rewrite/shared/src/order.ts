/**
 * 订单域状态机声明单源（状态串=前后端契约与库内数据，不可改名）。
 * 类型经 SpecStates 类型级派生，改声明即改类型，零生成器。
 */
import { statesOf, type SpecStates } from './status'

/** 订单状态机声明（orders 集合）。 */
export const ORDER_STATUS_SPEC = {
  collection: 'orders',
  /** 初始态：createOrder 写入（real→pending 等回调 / mock→paid 直付）。 */
  initial: ['pending', 'paid'],
  /** 终态。refund_required=钱已收但缺货、待人工退款；payment_exception=到账金额不符、待人工处理。 */
  terminal: ['done', 'closed', 'refund_required', 'payment_exception'],
  transitions: [
    { from: ['pending'], to: 'paid', trigger: 'pay/payCallback（0元单/支付成功·库存自下单持有）' },
    { from: ['pending'], to: 'closed', trigger: 'pay 惰性关单 / closeExpiredOrders 定时关单' },
    { from: ['closed'], to: 'paid', trigger: 'payCallback（关单后钱到账·重抢库存成功才复活）' },
    { from: ['closed'], to: 'refund_required', trigger: 'payCallback（关单回补后晚到回调·库存已被买走·钱已收待人工退款）' },
    { from: ['pending'], to: 'payment_exception', trigger: 'payCallback（到账金额不符·待人工核对）' },
    { from: ['closed'], to: 'payment_exception', trigger: 'payCallback（关单后到账金额不符·待人工核对）' },
    { from: ['paid', 'shipped'], to: 'shipped', trigger: 'adminApi.shipOrder（首发/改单号·幂等）' },
    { from: ['shipped'], to: 'done', trigger: 'confirmReceive（确认收货）' },
  ],
} as const

/** 售后状态机声明（afterSales 集合）。 */
export const AFTERSALE_STATUS_SPEC = {
  collection: 'afterSales',
  /** approved：overrideRefund 越规退款由管理员发起，直接以已批准建档。 */
  initial: ['applied', 'approved'],
  terminal: ['refunded', 'rejected'],
  transitions: [
    { from: ['applied'], to: 'approved', trigger: 'adminApi.approveRefund（原子抢占·触发退款工作流）' },
    { from: ['approved'], to: 'applied', trigger: 'adminApi.approveRefund 回滚（工作流未受理·条件化，不打回已退款）' },
    { from: ['applied'], to: 'rejected', trigger: 'adminApi.rejectRefund（拒绝售后）' },
    { from: ['applied', 'approved'], to: 'refunded', trigger: 'refundCallback（退款成功幂等）' },
  ],
} as const

export type OrderStatus = SpecStates<typeof ORDER_STATUS_SPEC>
export type AfterSaleStatus = SpecStates<typeof AFTERSALE_STATUS_SPEC>

/** 订单地址快照（createOrder 白名单四要素，按长度截断）。 */
interface OrderAddress {
  name: string
  phone: string
  region: string
  detail: string
}

/**
 * 订单行（下单那一刻的快照，不回读商品目录）。
 * 旧单可能缺 lineId / enteredQty / refundable：读侧一律带回退（lineId→productId、enteredQty→0、refundable 缺＝可退）。
 */
export interface OrderLine {
  productId: string
  /** `${productId}__${spec}`：同商品多规格同单时靠它定位行。 */
  lineId?: string
  name: string
  spec: string
  /** 单价，元。 */
  price: number
  qty: number
  /** 已确认进课的件数；进过课的件不可退。 */
  enteredQty?: number
  refundable?: boolean
  cover: string
}

/**
 * 订单文档（orders 集合）。金额单位：amount / goods / coupon / ship 是「元」（存库记元，运算一律 toFen 转分）；
 * paidFee / expectedFee / payerTotal / paidFeePrev 是「分」（支付回调与补录直接记微信的分）。
 * createdAt 之后的键按生命周期由不同动作写入，所以都是可选的。
 */
export interface OrderDoc {
  _id: string
  /** 与 _id 相同的可读单号，也是微信支付 out_trade_no。 */
  id: string
  _openid: string
  items: OrderLine[]
  /** 商品合计，元。 */
  goods: number
  /** 券抵扣，元。 */
  coupon: number
  /** 运费，元。 */
  ship: number
  /** 应付，元。 */
  amount: number
  address: OrderAddress
  /** 下单扣掉的库存（不限量的行不在里面）；关单/退款按它回补。 */
  reserved: { productId: string; spec: string; qty: number }[]
  status: OrderStatus
  createdAt: number
  paidAt?: number
  closedAt?: number
  cancelledBy?: string
  doneAt?: number
  transactionId?: string
  /** 微信原单总额 amount.total，分。只在金额不符、关单后收款进 refund_required、或人工补录时写；回调缺金额时为 null。 */
  paidFee?: number | null
  /** 用户实付 payer_total（扣掉微信/银行立减），分。只存档，不拿来核对。 */
  payerTotal?: number | null
  feeMismatch?: boolean
  /** 金额不符时留痕的应付，分。 */
  expectedFee?: number
  paymentMismatchDirection?: 'underpaid' | 'overpaid' | 'unknown'
  feeReceivedAt?: number
  feeMismatchClearedAt?: number
  revivedAt?: number
  /** 补录覆盖前的 paidFee，分。 */
  paidFeePrev?: number | null
  paidFeeRecordedAt?: number
  paidFeeRecordedBy?: string
  shipping?: { company: string; trackingNo: string }
  shippedAt?: number
  /** 发货上传互斥闸：busy＝有一次发货正在上传微信。 */
  shipUploadLock?: 'busy' | 'idle'
  shipUploadLockAt?: number
  wxShipUploaded?: boolean
  wxShipError?: string
  wxShipAt?: number
  /** confirmEnter 递增 enteredQty 时的乐观锁版本号。 */
  entVer?: number
  /** 退款回调记的逐行退款额，元；键是 lineId（点号洗成下划线）。 */
  refunded?: Record<string, number>
}

/**
 * 售后单文档（afterSales 集合）。_id＝`${orderId}__${lineId}`，同行再越规退款续 `__ovrN`。
 * 金额 itemTotal / refundAmount 是「元」。旧售后单可能缺 lineId（回退 productId）、qty（按整行）、outRefundNo（按 _id 现派生）。
 */
export interface AfterSaleDoc {
  _id: string
  orderId: string
  _openid: string
  lineId?: string
  productId: string
  name: string
  spec: string
  /** 退款件数；回补库存按它。 */
  qty?: number
  /** 退款件的货值，元。 */
  itemTotal: number
  /** 退款额，元：申请时云端分摊算定，审批时可能按当下剩余件数降级重算。 */
  refundAmount: number
  reason: string
  /** 发给微信的退款单号（_id 可能含中文，派生成 ASCII）。 */
  outRefundNo?: string
  status: AfterSaleStatus
  appliedAt: number
  /** 客户申请时的收货人快照；越规退款不记。 */
  addressName?: string
  phone?: string
  approvedAt?: number
  /** 管理员越规发起。 */
  overridden?: boolean
  requalifiedAt?: number
  rejectedAt?: number
  rejectReason?: string
  refundedAt?: number
  refundTransactionId?: string
  refundMismatch?: boolean
  refundStatus?: string
}

/** 已付订单状态集合单源（GMV/对账/客户画像总消费口径·防四处漂移）：pending/closed/
 *  refund_required 未付不计。此前 adminApi lib.ts / dashboard.ts / reconciliation.ts / customer360
 *  profile.ts 各自手抄同一份数组，改状态机漏改一处即口径分叉——收口到订单状态声明单源旁，其余四处改 import。 */
export const PAID_ORDER_STATUSES: readonly OrderStatus[] = ['paid', 'shipped', 'done']

/** 已收到钱的订单状态（对账口径）：refund_required 与 payment_exception 也收了款，漏掉会把它们的微信流水
 *  报成「微信有我方无」，而它们的退款又照常计入。GMV/画像仍用 PAID_ORDER_STATUSES。 */
export const MONEY_RECEIVED_STATUSES: readonly OrderStatus[] = [...PAID_ORDER_STATUSES, 'refund_required', 'payment_exception']

/** 占退款额度的售后状态（算已退/可退封顶时要减掉的）。 */
export const AFTERSALE_QUOTA_STATUSES: readonly AfterSaleStatus[] = ['applied', 'approved', 'refunded']
/** 在途售后（钱可能正在退）：有这类记录的订单不能发货。refunded 是终态，只把退掉的件排除出发货。 */
export const AFTERSALE_INFLIGHT_STATUSES: readonly AfterSaleStatus[] = ['applied', 'approved']

// 运行时状态全集（从声明派生·去重排序）；消费方仅作枚举（计数/筛选/白名单）。
export const ORDER_STATUS = statesOf(ORDER_STATUS_SPEC) as readonly OrderStatus[]
export const AFTERSALE_STATUS = statesOf(AFTERSALE_STATUS_SPEC) as readonly AfterSaleStatus[]

/**
 * 'BAD_STATUS:'+状态 复合码的构造单源。云端 orders/refunds 用本函数拼码；
 * 解析侧 mp payFlow.ts / admin Fulfill.vue 各自按字面量手动同步（mp 进不了 @ldrw/shared）——
 * 前缀不可改，一改三处（本文件 + mp + admin）都得跟着改。
 */
export function buildBadStatus(status: string): `BAD_STATUS:${string}` {
  // 拼接推不出模板类型只能断言；不改写成模板字符串，因为 check-structure「错误前缀」从下一行的字符串拼接里取前缀
  return 'BAD_STATUS:' + status as `BAD_STATUS:${string}`
}

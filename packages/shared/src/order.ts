/**
 * 订单域类型/常量/流转表——**生成物**（单源 order.spec.ts·勿手改生成段）。
 * 见 order.spec.ts 头注；改流转改声明再跑 scripts/gen-order-domain.mjs。
 */

// ⚠️ 此段由 scripts/gen-order-domain.mjs 从对应 *.spec.ts 生成——勿手改。改流转改声明源（order.spec.ts/learning.spec.ts）再跑生成器。
// === GENERATED:order-domain BEGIN ===
/** orders 状态联合（从 order.spec.ts 生成·写错状态名编译失败·根因#2）。 */
export type OrderStatus = 'closed' | 'done' | 'paid' | 'pending' | 'shipped'

export const ORDER_STATUS = {
  CLOSED: 'closed',
  DONE: 'done',
  PAID: 'paid',
  PENDING: 'pending',
  SHIPPED: 'shipped',
} as const satisfies Record<string, OrderStatus>

/** orders 合法流转表（机读·守卫 order-transitions-declared 对账散落实现）。 */
export const ORDER_TRANSITIONS: ReadonlyArray<{ from: readonly OrderStatus[]; to: OrderStatus }> = [
  { from: ['pending'], to: 'paid' }, // pay/payCallback（0元单/支付成功）
  { from: ['pending'], to: 'closed' }, // pay 惰性关单 / closeExpiredOrders 定时关单
  { from: ['closed'], to: 'paid' }, // payCallback（关单后钱到账·订单复活）
  { from: ['paid', 'shipped'], to: 'shipped' }, // adminApi.shipOrder（首发/改单号·幂等）
  { from: ['shipped'], to: 'done' }, // confirmReceive（确认收货）
]

/** afterSales 状态联合（从 order.spec.ts 生成·写错状态名编译失败·根因#2）。 */
export type AfterSaleStatus = 'applied' | 'approved' | 'refunded' | 'rejected'

export const AFTERSALE_STATUS = {
  APPLIED: 'applied',
  APPROVED: 'approved',
  REFUNDED: 'refunded',
  REJECTED: 'rejected',
} as const satisfies Record<string, AfterSaleStatus>

/** afterSales 合法流转表（机读·守卫 order-transitions-declared 对账散落实现）。 */
export const AFTERSALE_TRANSITIONS: ReadonlyArray<{ from: readonly AfterSaleStatus[]; to: AfterSaleStatus }> = [
  { from: ['applied'], to: 'approved' }, // adminApi.approveRefund（原子抢占·触发退款工作流）
  { from: ['approved'], to: 'applied' }, // adminApi.approveRefund 回滚（工作流未受理）
  { from: ['applied'], to: 'rejected' }, // adminApi.rejectRefund（拒绝售后）
  { from: ['applied', 'approved'], to: 'refunded' }, // refundCallback（退款成功幂等）
]
// === GENERATED:order-domain END ===

/**
 * 订单域状态机声明单源（镜像旧线 order.spec.ts·状态串=前后端契约与库内数据，不可改名——数据零迁移前提）。
 * 类型经 SpecStates 类型级派生，改声明即改类型，零生成器。（守卫 rw-contracts-golden parity 测试焊死与旧线逐字一致）
 */
import type { SpecStates } from './status'

/** 订单状态机声明（orders 集合）。 */
export const ORDER_STATUS_SPEC = {
  collection: 'orders',
  /** 初始态：createOrder 写入（real→pending 等回调 / mock→paid 直付）。 */
  initial: ['pending', 'paid'],
  /** 终态。refund_required=钱已收但缺货、待人工退款的死信态。 */
  terminal: ['done', 'closed', 'refund_required'],
  transitions: [
    { from: ['pending'], to: 'paid', trigger: 'pay/payCallback（0元单/支付成功·库存自下单持有）' },
    { from: ['pending'], to: 'closed', trigger: 'pay 惰性关单 / closeExpiredOrders 定时关单' },
    { from: ['closed'], to: 'paid', trigger: 'payCallback（关单后钱到账·重抢库存成功才复活）' },
    { from: ['closed'], to: 'refund_required', trigger: 'payCallback（关单回补后晚到回调·库存已被买走·钱已收待人工退款）' },
    { from: ['paid', 'shipped'], to: 'shipped', trigger: 'adminApi.shipOrder（首发/改单号·幂等）' },
    { from: ['shipped'], to: 'done', trigger: 'confirmReceive（确认收货）' },
  ],
} as const

/** 售后状态机声明（afterSales 集合）。 */
export const AFTERSALE_STATUS_SPEC = {
  collection: 'afterSales',
  initial: ['applied'],
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

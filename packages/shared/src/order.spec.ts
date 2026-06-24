/**
 * 订单域声明单源（P3「安全处生成」spike·北极星 A：需求当单一源、向下派生）。
 *
 * 本文件是**订单域状态机的声明式权威**——状态集合 + 合法流转表（含触发点）。它是「数据」，
 * 不含任何运行时逻辑（根因#8 铁律：只在安全处生成，永不重生成真机验过的运行时/UI）。
 *
 * 派生物（由 `scripts/gen-order-domain.mjs` 生成，勿手改生成段）：
 *   ① TS 类型/常量    → `order.ts`（OrderStatus/ORDER_STATUS/AfterSaleStatus/AFTERSALE_STATUS）
 *   ② 合法流转表       → `order.ts`（ORDER_TRANSITIONS/AFTERSALE_TRANSITIONS 机读，供守卫校验）
 *   ③ 守卫            → `scripts/check-structure.mjs` 的 `order-transitions-declared`
 *                       读这张表，把散落在云函数里的 raw `transition()` / `where(status).update(status)`
 *                       与声明对账——函数私自越流转即红（根因#2 状态散写从「靠人记」升「机器对账」）。
 *
 * 改流转只改这里 → 跑 `node scripts/gen-order-domain.mjs` 同步派生物 → check 绿。
 * 漂移（生成物 ≠ 声明，或函数流转 ∉ 声明）由两条守卫当场咬红。
 */

/** 订单状态机声明（orders 集合）。状态值＝前后端契约字符串（miniapp data/orders.js 按之映射展示·不可改名）。 */
export const ORDER_STATUS_SPEC = {
  collection: 'orders',
  /** 初始态：createOrder 写入（real→pending 等回调 / mock→paid 直付）。 */
  initial: ['pending', 'paid'] as const,
  /** 终态（无出边的状态，仅文档/可读性，不参与流转校验）。refund_required=钱已收但缺货、待人工退款的死信态。 */
  terminal: ['done', 'closed', 'refund_required'] as const,
  /** 合法流转：from[] → to，trigger 标触发函数（守卫据此对账散落的实现）。 */
  transitions: [
    { from: ['pending'], to: 'paid', trigger: 'pay/payCallback（0元单/支付成功·库存自下单持有）' },
    { from: ['pending'], to: 'closed', trigger: 'pay 惰性关单 / closeExpiredOrders 定时关单' },
    { from: ['closed'], to: 'paid', trigger: 'payCallback（关单后钱到账·重抢库存成功才复活）' },
    { from: ['closed'], to: 'refund_required', trigger: 'payCallback（关单回补后晚到回调·库存已被买走·钱已收待人工退款·审核 P0）' },
    { from: ['paid', 'shipped'], to: 'shipped', trigger: 'adminApi.shipOrder（首发/改单号·幂等）' },
    { from: ['shipped'], to: 'done', trigger: 'confirmReceive（确认收货）' },
  ],
} as const

/** 售后状态机声明（afterSales 集合）。 */
export const AFTERSALE_STATUS_SPEC = {
  collection: 'afterSales',
  /** 初始态：applyRefund 写入。 */
  initial: ['applied'] as const,
  /** 终态：已退款 / 已拒绝。 */
  terminal: ['refunded', 'rejected'] as const,
  transitions: [
    { from: ['applied'], to: 'approved', trigger: 'adminApi.approveRefund（原子抢占·触发退款工作流）' },
    { from: ['approved'], to: 'applied', trigger: 'adminApi.approveRefund 回滚（工作流未受理）' },
    { from: ['applied'], to: 'rejected', trigger: 'adminApi.rejectRefund（拒绝售后）' },
    { from: ['applied', 'approved'], to: 'refunded', trigger: 'refundCallback（退款成功幂等）' },
  ],
} as const

/** 全部声明的状态机（生成器与守卫共用入口·新增状态机加这里）。 */
export const STATUS_MACHINES = [ORDER_STATUS_SPEC, AFTERSALE_STATUS_SPEC] as const

/** 从一个状态机声明导出其全部出现过的状态字符串（init + terminal + 流转两端·去重）。 */
export function statesOf(spec: {
  initial: readonly string[]
  terminal: readonly string[]
  transitions: readonly { from: readonly string[]; to: string }[]
}): string[] {
  const set = new Set<string>([...spec.initial, ...spec.terminal])
  for (const t of spec.transitions) {
    for (const f of t.from) set.add(f)
    set.add(t.to)
  }
  return [...set].sort()
}

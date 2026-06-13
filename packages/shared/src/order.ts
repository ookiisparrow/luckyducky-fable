/**
 * 订单状态联合类型（根因账本 #2：状态散写 → 写错状态名编译失败）。
 * 合法流转表由 kit.transition() 运行期校验；类型与流转同源，B4 起 transition 直接吃此表。
 */
export type OrderStatus = 'pending' | 'paid' | 'shipped' | 'done' | 'closed'

export const ORDER_STATUS = {
  PENDING: 'pending',
  PAID: 'paid',
  SHIPPED: 'shipped',
  DONE: 'done',
  CLOSED: 'closed',
} as const satisfies Record<string, OrderStatus>

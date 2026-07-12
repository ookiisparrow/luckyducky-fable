/**
 * 状态码 → 中文标签单源（orders / afterSales / purchaseOrders / outworkOrders·P2 顺手改批收口）。
 *
 * 与状态机声明的类型绑定（Record<OrderStatus,...> 等）：canonical 状态集合新增/改名，这里漏配标签直接
 * 编译期报错（根因#2 同款纪律）——比此前 admin/mp 各自散抄 `Record<string,string>` 强，那种写法加了新状态
 * 忘配标签只会在页面上悄悄显示原始状态码，不会报错。
 *
 * 订单/售后各导两份、不强合——语境有意不同（CLAUDE §7「本质相同还是碰巧长得像」判断结果＝碰巧长得像）：
 *   · orders.shipped：admin「已发货」（站在商家做了什么）vs mp「待收货」（站在客户还要等什么）
 *   · afterSales.applied/approved：admin 用简洁运营词，mp 用更完整的客户安抚措辞（"已同意 · 退款处理中"）
 * 机械合并成一份会牺牲某一端的 UX 针对性，故不合并；两份都在此单源维护，改一处即两端都过一遍 review。
 *
 * mp 包进不了本模块（微信开发者工具编译不出仓外引用——同 rewrite/mp/lib/checkoutConst.ts 头注），mp 仍手落
 * 一份副本（见 rewrite/mp/lib/mapOrders.ts / mapAftersales.ts 头注），改用 scripts/check-structure.mjs 的
 * rw-mp-order-labels-synced 守卫焊住「状态码集合」与本文件一致（措辞允许不同，状态漏配不允许）。
 * admin 无此限制（vite.config.ts 经 esbuild alias 直连本模块 TS 源，同 rewrite/cloud/build.mjs 既有先例），
 * 直接 import 用，不再手抄。
 */
import type { OrderStatus, AfterSaleStatus } from './order'
import type { PurchaseOrderStatus, OutworkOrderStatus } from './scm'

/** 订单状态·运营向标签（admin 消费：rewrite/admin/src/lib/format.ts）。 */
export const ORDER_STATUS_LABEL_OPS: Record<OrderStatus, string> = {
  pending: '待支付',
  paid: '待发货',
  shipped: '已发货',
  done: '已完成',
  closed: '已关闭',
  refund_required: '待退款', // PAID_BUT_OOS 死信（已付但缺货·待人工退款）·非「退款处理中」（与退款 approved 撞车）
}

/** 订单状态·客户向标签（mp 手落副本消费：rewrite/mp/lib/mapOrders.ts，见该文件头注）。 */
export const ORDER_STATUS_LABEL_CUSTOMER: Record<OrderStatus, string> = {
  pending: '待支付',
  paid: '待发货',
  shipped: '待收货',
  done: '已完成',
  closed: '已关闭',
  refund_required: '待退款',
}

/** 售后状态·运营向标签（admin 消费：rewrite/admin/src/lib/format.ts）。 */
export const AFTERSALE_STATUS_LABEL_OPS: Record<AfterSaleStatus, string> = {
  applied: '待审核',
  approved: '退款处理中',
  refunded: '已退款',
  rejected: '已拒绝',
}

/** 售后状态·客户向标签（mp 手落副本消费：rewrite/mp/lib/mapAftersales.ts，见该文件头注）。 */
export const AFTERSALE_STATUS_LABEL_CUSTOMER: Record<AfterSaleStatus, string> = {
  applied: '申请中',
  approved: '已同意 · 退款处理中',
  refunded: '已退款',
  rejected: '已拒绝',
}

/** 采购单状态标签（admin SCM 板块专属·无 mp 对应端，仍收口到此单源，防新增状态漏配标签）。 */
export const PURCHASE_ORDER_STATUS_LABEL: Record<PurchaseOrderStatus, string> = {
  draft: '草稿',
  ordered: '已下单',
  received: '已收货',
  cancelled: '已取消',
}

/** 外协单状态标签（admin SCM 板块专属）。 */
export const OUTWORK_ORDER_STATUS_LABEL: Record<OutworkOrderStatus, string> = {
  draft: '草稿',
  issued: '已发料',
  delivered: '已收货',
  settled: '已结算',
  cancelled: '已取消',
}

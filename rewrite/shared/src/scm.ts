/**
 * SCM 进销存域（采购/外协单）类型/常量/流转表——**生成物**（单源 scm.spec.ts·勿手改生成段）。
 * 见 scm.spec.ts 头注；改流转改声明再跑 scripts/gen-order-domain.mjs。
 */

// ⚠️ 此段由 scripts/gen-order-domain.mjs 从对应 *.spec.ts 生成——勿手改。改流转改声明源（order.spec.ts/learning.spec.ts）再跑生成器。
// === GENERATED:order-domain BEGIN ===
/** purchaseOrders 状态联合（从 scm.spec.ts 生成·写错状态名编译失败·根因#2）。 */
export type PurchaseOrderStatus = 'cancelled' | 'draft' | 'ordered' | 'received'

export const PURCHASE_ORDER_STATUS = {
  CANCELLED: 'cancelled',
  DRAFT: 'draft',
  ORDERED: 'ordered',
  RECEIVED: 'received',
} as const satisfies Record<string, PurchaseOrderStatus>

/** purchaseOrders 合法流转表（机读声明·用户拍板 2026-07-12 保留：ERP R31 活线的状态机单源预留；
 *  注：order-transitions-declared 守卫现只扫旧线，重写线对账接线为待办债——接线前本表暂无机器消费者）。 */
export const PURCHASE_ORDER_TRANSITIONS: ReadonlyArray<{ from: readonly PurchaseOrderStatus[]; to: PurchaseOrderStatus }> = [
  { from: ['draft'], to: 'ordered' }, // markOrdered 向厂家下单（车道 A）
  { from: ['ordered'], to: 'received' }, // receivePurchase 到货入库（首次流转绑 applyStockMoves purchase_in·幂等）
  { from: ['draft', 'ordered'], to: 'cancelled' }, // cancelPurchase 取消（未入库的单·入库后不可取消，走调整单）
]

/** outworkOrders 状态联合（从 scm.spec.ts 生成·写错状态名编译失败·根因#2）。 */
export type OutworkOrderStatus = 'cancelled' | 'delivered' | 'draft' | 'issued' | 'settled'

export const OUTWORK_ORDER_STATUS = {
  CANCELLED: 'cancelled',
  DELIVERED: 'delivered',
  DRAFT: 'draft',
  ISSUED: 'issued',
  SETTLED: 'settled',
} as const satisfies Record<string, OutworkOrderStatus>

/** outworkOrders 合法流转表（机读声明·保留理由同上 PURCHASE_ORDER_TRANSITIONS）。 */
export const OUTWORK_ORDER_TRANSITIONS: ReadonlyArray<{ from: readonly OutworkOrderStatus[]; to: OutworkOrderStatus }> = [
  { from: ['draft'], to: 'issued' }, // issueOutwork 发料（最大团原团按色出库·applyStockMoves outwork_issue）
  { from: ['issued'], to: 'delivered' }, // receiveOutwork 交付（带结团入库 outwork_receive + 定格损耗与 payableFen）
  { from: ['delivered'], to: 'settled' }, // settleOutwork 工钱结清销账
  { from: ['draft'], to: 'cancelled' }, // cancelOutwork 取消（仅未发料·发料后异常走调整单兜底·MVP 不做逆向流转）
]
// === GENERATED:order-domain END ===

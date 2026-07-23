/**
 * SCM 进销存域（采购/外协单）类型/常量/流转表——2026-07-23 起为**手改单源**（原 scm.spec.ts 谱源与
 * gen-order-domain 生成器已随瘦身批退役）。改流转须同步 scripts/order-domain.generated.json（rw-scm-transitions-declared 对账守卫会拦漂移）。
 */

// === order-domain 状态域声明 BEGIN（原生成段·生成器已退役，本段即手改单源，见文件头注） ===
/** purchaseOrders 状态联合（写错状态名编译失败·根因#2）。 */
export type PurchaseOrderStatus = 'cancelled' | 'draft' | 'ordered' | 'received'

export const PURCHASE_ORDER_STATUS = {
  CANCELLED: 'cancelled',
  DRAFT: 'draft',
  ORDERED: 'ordered',
  RECEIVED: 'received',
} as const satisfies Record<string, PurchaseOrderStatus>

/** purchaseOrders 合法流转表（机读·守卫 order-transitions-declared 对账散落实现）。 */
export const PURCHASE_ORDER_TRANSITIONS: ReadonlyArray<{ from: readonly PurchaseOrderStatus[]; to: PurchaseOrderStatus }> = [
  { from: ['draft'], to: 'ordered' }, // markOrdered 向厂家下单（车道 A）
  { from: ['ordered'], to: 'received' }, // receivePurchase 到货入库（首次流转绑 applyStockMoves purchase_in·幂等）
  { from: ['draft', 'ordered'], to: 'cancelled' }, // cancelPurchase 取消（未入库的单·入库后不可取消，走调整单）
]

/** outworkOrders 状态联合（写错状态名编译失败·根因#2）。 */
export type OutworkOrderStatus = 'cancelled' | 'delivered' | 'draft' | 'issued' | 'settled'

export const OUTWORK_ORDER_STATUS = {
  CANCELLED: 'cancelled',
  DELIVERED: 'delivered',
  DRAFT: 'draft',
  ISSUED: 'issued',
  SETTLED: 'settled',
} as const satisfies Record<string, OutworkOrderStatus>

/** outworkOrders 合法流转表（机读·守卫 order-transitions-declared 对账散落实现）。 */
export const OUTWORK_ORDER_TRANSITIONS: ReadonlyArray<{ from: readonly OutworkOrderStatus[]; to: OutworkOrderStatus }> = [
  { from: ['draft'], to: 'issued' }, // issueOutwork 发料（最大团原团按色出库·applyStockMoves outwork_issue）
  { from: ['issued'], to: 'delivered' }, // receiveOutwork 交付（带结团入库 outwork_receive + 定格损耗与 payableFen）
  { from: ['delivered'], to: 'settled' }, // settleOutwork 工钱结清销账
  { from: ['draft'], to: 'cancelled' }, // cancelOutwork 取消（仅未发料·发料后异常走调整单兜底·MVP 不做逆向流转）
]
// === order-domain 状态域声明 END ===

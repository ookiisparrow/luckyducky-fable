/**
 * 进销存 SCM 域状态机声明单源（SCM-0 门2·蓝图 docs/进销存ERP/施工蓝图.md §1·北极星 A：需求当单一源）。
 *
 * 与 order.spec.ts 同款声明式权威——状态集合 + 合法流转表（含触发点）。纯「数据」、零运行时逻辑
 * （根因#8 铁律：只在安全处生成，永不重生成真机验过的运行时/UI）。车道 A/B 对着本表实现（契约先行·
 * 地基一次声明，两车道不各自改 gen 脚本＝消灭共享面冲突）。
 *
 * 派生物（由 `scripts/gen-order-domain.mjs` 一并生成·勿手改生成段）：
 *   ① TS 类型/常量 → `scm.ts`（PurchaseOrderStatus/OutworkOrderStatus + 常量 + 流转表）
 *   ② 机读流转表   → 并入 `scripts/order-domain.generated.json`（守卫 order-transitions-declared 读它·
 *      扫描面已扩 actions/scm*.ts——车道私自越流转/写未声明状态即红）
 *
 * 改流转只改这里 → 跑 `node scripts/gen-order-domain.mjs` 同步派生物 → check 绿。
 *
 * ⚠️ 范式边界：assemblyOrders（组装单）**单步执行无状态机**（建即执行·撤销走调整单·CLAUDE §7
 * 别为不存在的草稿需求建状态机），诚实不纳入本表——同 activations.enteredAt 先例。
 */

/** 采购单状态机（purchaseOrders 集合·车道 A）。received 首次流转绑入库副作用（门1 幂等）。 */
export const PURCHASE_ORDER_STATUS_SPEC = {
  collection: 'purchaseOrders',
  /** 初始态：savePurchase 建单写入。 */
  initial: ['draft'] as const,
  /** 终态：已入库 / 已取消。 */
  terminal: ['received', 'cancelled'] as const,
  transitions: [
    { from: ['draft'], to: 'ordered', trigger: 'markOrdered 向厂家下单（车道 A）' },
    { from: ['ordered'], to: 'received', trigger: 'receivePurchase 到货入库（首次流转绑 applyStockMoves purchase_in·幂等）' },
    { from: ['draft', 'ordered'], to: 'cancelled', trigger: 'cancelPurchase 取消（未入库的单·入库后不可取消，走调整单）' },
  ],
} as const

/** 外协加工单状态机（outworkOrders 集合·车道 B）。issued 绑发料出库、delivered 绑收带结入库+定格应付。 */
export const OUTWORK_ORDER_STATUS_SPEC = {
  collection: 'outworkOrders',
  /** 初始态：saveOutwork 建单写入。 */
  initial: ['draft'] as const,
  /** 终态：已结算 / 已取消。 */
  terminal: ['settled', 'cancelled'] as const,
  transitions: [
    { from: ['draft'], to: 'issued', trigger: 'issueOutwork 发料（最大团原团按色出库·applyStockMoves outwork_issue）' },
    { from: ['issued'], to: 'delivered', trigger: 'receiveOutwork 交付（带结团入库 outwork_receive + 定格损耗与 payableFen）' },
    { from: ['delivered'], to: 'settled', trigger: 'settleOutwork 工钱结清销账' },
    { from: ['draft'], to: 'cancelled', trigger: 'cancelOutwork 取消（仅未发料·发料后异常走调整单兜底·MVP 不做逆向流转）' },
  ],
} as const

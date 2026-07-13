// admin 内部展示阈值单源（P2 顺手改批·非跨端业务规则，不进 shared——admin 前端预警线是「后台怎么标黄」
// 的展示判断，不是订单/售后那类前后端都要认的状态契约，放 admin/src/lib 即可）。
// 之前 Inventory.vue / Dashboard.vue 各自硬编码 `10`，两处改一处漏就会看板计数与库存页页内计数不一致。

/** 低库存预警默认阈值（per-SKU 未设 threshold 时退此；Inventory.vue 行内展示 + Dashboard.vue 待处理计数同口径）。 */
export const LOW_STOCK_THRESHOLD = 10

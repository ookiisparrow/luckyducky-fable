// admin 内部展示阈值单源（P2 顺手改批·非跨端业务规则，不进 shared——admin 前端预警线是「后台怎么标黄」
// 的展示判断，不是订单/售后那类前后端都要认的状态契约，放 admin/src/lib 即可）。
// 之前 Inventory.vue / Dashboard.vue 各自硬编码 `10`，两处改一处漏就会看板计数与库存页页内计数不一致。

/** 低库存预警默认阈值（per-SKU 未设或 ≤0 时退此）。库存页标色与看板「低库存/售罄」计数都走 stockAlertOf。 */
export const LOW_STOCK_THRESHOLD = 10

export type StockAlert = 'unlimited' | 'out' | 'low' | 'onsale'

/** 库存行状态：null＝不限量；0＝售罄；其余 ≤（threshold>0 否则 fallback）＝低库存。 */
export function stockAlertOf(stock: number | null, threshold: number, fallback = LOW_STOCK_THRESHOLD): StockAlert {
  if (stock == null) return 'unlimited'
  if (stock === 0) return 'out'
  if (stock <= (threshold > 0 ? threshold : fallback)) return 'low'
  return 'onsale'
}

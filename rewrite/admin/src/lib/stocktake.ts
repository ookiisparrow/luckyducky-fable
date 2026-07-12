// 批量盘点（批 B3）：ScmMaterials「批量盘点」模式的纯逻辑——期初盘点录入现只能逐行开调整单弹窗
// （SCM-Z 靠人项「不录=账实必偏」），本批加一屏批量录实盘→差异预览→复用既有 adjustStock 幂等键一次提交。
// 纯函数（可注入 now/rand 便于测试）；副作用（listMaterials 拉全量/逐行调 adjustStock）留在 ScmMaterials.vue。

/** 实盘数合法性：只有非负整数才算「已盘」——空/负数/小数/非数一律不合法（视同未盘，不进提交）。 */
export function isValidActual(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v) && v >= 0
}

/** 差异 = 实盘 − 账面；未盘/非法输入 → null（模板显示「—」灰，不是 0）。 */
export function stocktakeDiff(stock: number, actual: unknown): number | null {
  if (!isValidActual(actual)) return null
  return actual - stock
}

export interface StocktakeRow {
  materialId: string
  stock: number
  actual: unknown
}

export interface StocktakeSubmitRow {
  materialId: string
  delta: number
}

/** 待提交行：已填实盘（非负整数）且差异≠0——0 差异/未填/非法输入一律剔除，不提交空调整。 */
export function filterSubmittable(rows: StocktakeRow[]): StocktakeSubmitRow[] {
  const out: StocktakeSubmitRow[] = []
  for (const r of rows) {
    const delta = stocktakeDiff(r.stock, r.actual)
    if (delta !== null && delta !== 0) out.push({ materialId: r.materialId, delta })
  }
  return out
}

/** 盘点单号：ST-<yyyymmdd>-<4位随机>（可注入 now/rand 便于测试稳定断言）。 */
export function genStocktakeNo(now: number = Date.now(), rand: () => number = Math.random): string {
  const d = new Date(now)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const suffix = String(Math.floor(rand() * 10000)).padStart(4, '0')
  return `ST-${yyyy}${mm}${dd}-${suffix}`
}

/** adjustId = 盘点单号-料号：同单号同料恒同键——失败重试复用同键（幂等·不重复扣），成功行天然锁定不再变。 */
export function stocktakeAdjustId(stocktakeNo: string, materialId: string): string {
  return `${stocktakeNo}-${materialId}`
}

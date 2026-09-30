// 列表新鲜度单源（老板 2026-10-01 性能批 #2）：订单/课程/「我」页从别页返回时，30s 内拉过且期间没人写过就不重拉
// （不闪 loading、不白付一次云往返·单次往返实测 350–550ms）。
// 写类 api（下单/支付/取消/收货/售后·激活/进课/进度埋点）完成时 markStale(key)——标在 api 层，所有调用方自动覆盖，
// 不逐页埋点；页面只记自己上次拉成功的时刻，onShow 用 isFresh 判。utils 是叶层，api/ 与 pages/ 都能引。
// 键：'orders'＝本人订单与售后；'learning'＝我的课与学习进度。
export const FRESH_MS = 30_000

const staleAt: Record<string, number> = {}

/** 某类数据刚被写过：此后所有早于此刻拉的都不算新鲜。 */
export function markStale(key: string): void {
  staleAt[key] = Date.now()
}

/** 页面上次拉成功的时刻 fetchedAt 是否仍可复用：拉过、窗内、且拉完之后没人写过（同一毫秒内有写按不新鲜算，宁可多拉）。 */
export function isFresh(key: string, fetchedAt: number, windowMs: number, now = Date.now()): boolean {
  return fetchedAt > 0 && now - fetchedAt < windowMs && fetchedAt > (staleAt[key] || 0)
}

/** 仅测试：清空标脏记录。 */
export function __resetForTest(): void {
  for (const k of Object.keys(staleAt)) delete staleAt[k]
}

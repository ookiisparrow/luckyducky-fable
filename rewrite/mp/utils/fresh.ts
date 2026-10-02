// 列表新鲜度：从别页返回时，30s 内拉过且期间没人写过就不重拉（省一次 350–550ms 的云往返、不闪 loading）。
// 写类 api 完成时在 api 层 markStale(key)，调用方不用各自记；页面只记自己上次拉成功的时刻，onShow 用 isFresh 判。
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

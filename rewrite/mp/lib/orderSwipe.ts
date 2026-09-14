// 我的订单页手势滑动换 tab 纯逻辑单源：抬指判定 + 越界钳制。
// 不做跟手动画；不碰 reload/_seq/onReachBottom。页面只在判定命中时调用既有 switchTab。

const SWIPE_MIN_DX = 60 // 最小横向位移 px（低于此不算滑动手势）
const SWIPE_ANGLE_GUARD = 1.5 // 角度护栏：|dx| 须大于 |dy| 的这个倍数，排除纵向滚动误判为横滑
const SWIPE_MAX_DT = 600 // 最大耗时 ms（超过判定为慢拖，不触发切换）

/** 抬指手势判定：dx/dy 为位移 px（changedTouches 终点 - touchstart 起点），dt 为耗时 ms。
 *  命中横滑阈值+角度护栏+耗时上限 → 1（手指左滑，去右边下一个 tab）或 -1（手指右滑，去左边上一个 tab）；
 *  否则 0（不触发，含纵向滚动/慢拖/位移不足）。 */
export function swipeDir(dx: number, dy: number, dt: number): -1 | 0 | 1 {
  if (Math.abs(dx) <= SWIPE_MIN_DX) return 0
  if (Math.abs(dx) <= SWIPE_ANGLE_GUARD * Math.abs(dy)) return 0
  if (dt >= SWIPE_MAX_DT) return 0
  return dx < 0 ? 1 : -1
}

/** 按当前 tab key 在 tabs 表内的位置 + 方向取下一个 key；越界（已在最左/最右）或
 *  currentKey 不在表内 → null（静默 no-op，不抖动不报错）。 */
export function nextTabKey(
  tabs: ReadonlyArray<{ key: string }>,
  currentKey: string,
  dir: 1 | -1,
): string | null {
  const i = tabs.findIndex((t) => t.key === currentKey)
  if (i === -1) return null
  const j = i + dir
  if (j < 0 || j >= tabs.length) return null
  return tabs[j].key
}

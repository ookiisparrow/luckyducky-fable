// 我的订单页手势滑动换 tab 纯逻辑单源（mp-7fixes 批2）：抬指判定 + 越界钳制。
// 不做跟手动画（需求未要求，防过度工程）；不碰 reload/_seq/onReachBottom 分页机制——
// 页面层只在判定命中时调用既有 switchTab，逻辑与既有状态机完全解耦。
//
// 与旧线差异（有意识·非疏漏）：旧线 packages/miniapp 对「订单列表左右滑切 tab」立过
// swipe-native-swiper 守卫（scripts/check-structure.mjs），钉死须用原生 <swiper>+<swiper-item>，
// 理由是自造 touchmove 计算真机易误触纵向滚动（H5 假绿）。该守卫扫描面硬编码在
// packages/miniapp/src 下的旧线文件路径，本就不覆盖 rewrite/mp（新线约定见 rewrite/mp/README.md，
// 随线重议）。这里选自造 touch 判定而非 swiper，是因为 order-list 现为「单份共享列表 + Page 级
// 原生滚动 + onReachBottom 游标分页（reload/_seq）」，接 swiper 须拆五份独立 tab 状态并把每个
// tab 包一层 scroll-view——旧线接 swiper 时正是这样「实质重构」过（见 docs/archive/重构日志-202606上半.md
// 2026-06-18 条）；本批规格明确
// 不许动这套滚动/分页机制，故延续本文件已有的自造 touch 手势范式（同 lib/flipLever.ts、
// player 自绘 seek 条），用角度护栏（|dx|>1.5|dy|）+ 耗时上限缓解误触。真机横滑 vs 纵向滚动/上拉
// 翻页误触仍待走查（根因#8·rewrite/mp/README.md 走查表第 9 项「五栏切换」覆盖）。

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

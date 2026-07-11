// 震感配方单源（2026-07-11 用户真机拍板定版·迁自 lib/flipLever，防复制漂移·病根#5）：
// ① 拖动逐格 light「嗒」（shouldTick）——翻过一帧即震，40ms 钳制快扫跳齿（安卓马达连震过密会糊成嗡，
//    钳住即物理「阻尼上限」）；② 事件震（medium/light）≥80ms 节流；两类震共用同一时间地板防叠震。
// 数值（VIBE_GAP_MS/DRAG_TICK_GAP_MS）为用户真机拍板定版，改动需用户重新拍板。
// 播放页 seek 条即将复用本配方（教学播放重设计战役），故收口共享单源、不留 flipLever 复制体。

export const VIBE_GAP_MS = 80 // 事件震节流地板
export const DRAG_TICK_GAP_MS = 40 // 拖动阻尼「嗒」最小间隔

/** 拖动持续阻尼震感（2026-07-11 用户需求）：翻过一帧即「嗒」一下——拖得快嗒得密、天然像拨过带齿滑槽；
 *  最小间隔钳制让快扫自动跳齿（安卓马达连震过密会糊成嗡，钳住即物理「阻尼上限」）。 */
export function shouldTick(prevFrame: number, frame: number, sinceLastMs: number, minGapMs: number): boolean {
  return frame !== prevFrame && sinceLastMs >= minGapMs
}

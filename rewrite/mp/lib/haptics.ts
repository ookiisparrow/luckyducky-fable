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

// 主按钮点按触觉反馈（2026-07-14 用户需求「深色主要按钮都增加震动反馈」）：深色/紫墨填充主 CTA 点按时「震一下」，
// 默认 medium 档作点按确认（light 在多数马达上几乎无感·真机反馈后从 light 上调 medium·区别于拖动逐格「嗒」/进节点重嗒）。
// 模块级 VIBE_GAP_MS 节流：防连点/同一动作重复触发时叠震成「嗡」（复用事件震同一时间地板）。收口本单源
// （病根#5 防复制漂移·守卫 rw-mp-tap-haptic-single-source 禁页面散写裸 wx.vibrateShort、一律走本 helper）。
// 调用纪律：放在处理器的禁用/无效早退守卫「之后」、动作真正提交前——禁用态/无效态点击不该震（见各页调用点）。
// 真机兼容（根因#8·官方文档+社区核实）：type 分级需基础库 2.13.0+，老库忽略 type 仍震默认档（故直传 type 无害·不必特性
// 检测）；wx/vibrateShort 存在性兜底防非小程序环境（测试）崩。设备侧坑（代码救不了、只能提示）：iOS 需「设置→声音与
// 触感→系统触感反馈」开启（关则静默且仍报 success）+ 关低电量模式；开发者工具模拟器不震、只真机震。
let lastTapVibe = 0
export function tapHaptic(type: 'light' | 'medium' | 'heavy' = 'medium'): void {
  const now = Date.now()
  if (now - lastTapVibe < VIBE_GAP_MS) return
  lastTapVibe = now
  if (typeof wx === 'undefined' || typeof wx.vibrateShort !== 'function') return
  wx.vibrateShort({ type })
}

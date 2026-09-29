// 震感配方单源（用户真机拍板定版·防复制漂移·病根#5）：
// ① 拖动逐格 light「嗒」（shouldTick）——翻过一帧即震，40ms 钳制快扫跳齿（安卓马达连震过密会糊成嗡，
//    钳住即物理「阻尼上限」）；② 事件震（medium/light）≥80ms 节流；两类震共用同一时间地板防叠震。
// 数值（VIBE_GAP_MS/DRAG_TICK_GAP_MS）为用户真机拍板定版，改动需用户重新拍板。
// 播放页 seek 条已用本配方（player.ts onSeekTick）。

export const VIBE_GAP_MS = 80 // 事件震节流地板
export const DRAG_TICK_GAP_MS = 40 // 拖动阻尼「嗒」最小间隔

/** 拖动持续阻尼震感（用户需求）：翻过一帧即「嗒」一下——拖得快嗒得密、天然像拨过带齿滑槽；
 *  最小间隔钳制让快扫自动跳齿（安卓马达连震过密会糊成嗡，钳住即物理「阻尼上限」）。 */
export function shouldTick(prevFrame: number, frame: number, sinceLastMs: number, minGapMs: number): boolean {
  return frame !== prevFrame && sinceLastMs >= minGapMs
}

// 主按钮点按触觉反馈（用户需求「深色主要按钮都增加震动反馈」）：深色/紫墨填充主 CTA 点按时「震一下」，
// 默认 medium 档作点按确认（light 在多数马达上几乎无感·区别于拖动逐格「嗒」/进节点重嗒）。
// 模块级 VIBE_GAP_MS 节流：防连点/同一动作重复触发时叠震成「嗡」（复用事件震同一时间地板）。收口本单源
// （病根#5 防复制漂移·页面禁散写裸 wx.vibrateShort、一律走本 helper）。
// 调用纪律：放在处理器的禁用/无效早退守卫「之后」、动作真正提交前——禁用态/无效态点击不该震（见各页调用点）。
// 真机兼容（根因#8·官方文档+社区核实）：type 分级需基础库 2.13.0+，老库忽略 type 仍震默认档（故直传 type 无害·不必特性
// 检测）；wx/vibrateShort 存在性兜底防非小程序环境（测试）崩。设备侧坑（代码救不了、只能提示）：iOS 需「设置→声音与
// 触感→系统触感反馈」开启（关则静默且仍报 success）+ 关低电量模式；开发者工具模拟器不震、只真机震。
// v5 按键手感（lib/keyFx·老板 2026-09-28「按设计稿实现」）：每颗键按下时已震过一次，同一次点按里处理器
// 再调 tapHaptic 就跳过——一次点按只震一下（KEY_VIBE_WINDOW_MS 覆盖按下到松手触发 tap 的间隔；
// 须短于最短的按住时长 600ms，按住删除/退出「成了」那一下确认震不能被吞）。
export const KEY_VIBE_WINDOW_MS = 450
let lastKeyVibe = 0
const vibe = (type: 'light' | 'medium' | 'heavy') => {
  if (typeof wx !== 'undefined' && typeof wx.vibrateShort === 'function') wx.vibrateShort({ type })
}
/** 键按下那一震（lib/keyFx 调）：记下时间，让同一次点按里的 tapHaptic 不再叠震。 */
export function keyHaptic(type: 'light' | 'medium'): void {
  lastKeyVibe = Date.now()
  vibe(type)
}
/** 大撒花的「哒-哒-哒」三连（设计稿 navigator.vibrate([14,60,20,60,30])，间隔取事件震节流地板）。 */
export function burstHaptic(): void {
  for (let i = 0; i < 3; i++) setTimeout(() => vibe(i === 2 ? 'medium' : 'light'), i * VIBE_GAP_MS)
}
let lastTapVibe = 0
export function tapHaptic(type: 'light' | 'medium' | 'heavy' = 'medium'): void {
  const now = Date.now()
  if (now - lastKeyVibe < KEY_VIBE_WINDOW_MS) return
  if (now - lastTapVibe < VIBE_GAP_MS) return
  lastTapVibe = now
  if (typeof wx === 'undefined' || typeof wx.vibrateShort !== 'function') return
  wx.vibrateShort({ type })
}

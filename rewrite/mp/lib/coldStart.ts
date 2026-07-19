// 冷启动耗时上报（R41·上线前必埋钩子）：app onLaunch 记时间戳→home 首帧 onReady 算 delta 上报，仅首次。
// lib/ 可 import api/（T4·rw-dep-direction 允许方向）：本文件需调 trackEvent，故不能放 utils/（utils 出度恒为0）。
// 「仅首次」双保险：① home 是 tabBar 常驻页，onReady 生命周期本就只在首次渲染触发一次（切 tab 回来走
// onShow 不重放）；② reported 锁再兜一层——防将来误把 reportColdStart() 接到会重复触发的生命周期上时静默重复上报。
import { trackEvent } from '../api/learning'

let launchAt = 0
let reported = false

/** app onLaunch 首行调用：记冷启动计时起点。 */
export function markLaunch(): void {
  launchAt = Date.now()
}

/** home 首帧 onReady 调用：算 delta 上报一次（重复调用/未先 markLaunch 静默跳过）。 */
export function reportColdStart(): void {
  if (reported || !launchAt) return
  reported = true
  trackEvent('cold_start', 'home', '', { ms: Date.now() - launchAt })
}

/** 仅测试：重置内存态。 */
export function __resetForTest(): void {
  launchAt = 0
  reported = false
}

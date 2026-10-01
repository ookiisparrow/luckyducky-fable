// 开屏在场标记（brand-splash 置·custom-tab-bar 挂载时读）：TabBar 晚于开屏挂上时一挂上就藏好，
// 不在开屏上先闪一下（老板真机 2026-10-02）。开屏撤场 / 卸载即清。
let up = false
export const splashUp = (): boolean => up
export function setSplashUp(v: boolean): void {
  up = v
}

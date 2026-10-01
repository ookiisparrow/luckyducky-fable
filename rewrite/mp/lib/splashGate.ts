// 开屏在场开关（brand-splash 置·custom-tab-bar 订阅，镜像 lib/loginGate 广播范式）：开屏在场时所有 TabBar 让位，
// 撤场即广播、每个 TabBar 都回来。只通知首页那一个不够——开屏期间切到别的页，那页 TabBar 挂上时被藏，
// 开屏撤了没人通知它就一直藏着、只能重进（老板真机 2026-10-02）。
type Sub = (fade: boolean) => void
let up = false
const subs = new Set<Sub>()

export const splashUp = (): boolean => up

/** 置开关；变了才广播。fade＝撤场时 TabBar 跟着淡入（开屏淡出同步）。 */
export function setSplashUp(v: boolean, fade = false): void {
  if (up === v) return
  up = v
  subs.forEach((f) => f(!v && fade))
}

export function onSplash(fn: Sub): () => void {
  subs.add(fn)
  return () => {
    subs.delete(fn)
  }
}

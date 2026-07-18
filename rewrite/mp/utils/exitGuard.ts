// tabBar 栈底页「误触退出提醒」单源（决策§30·2026-07-14 定论落地于 2026-07-18）。
// 病：tabBar 三页（首页/购物车/我）是页面栈底，安卓实体返回键＝直接退出小程序，误触即丢会话。
//
// 机制（唯一可行的一条路）：隐形 <page-container> 武装拦第一次返回 →「再按一次退出」。
//   page-container 拦返回看「本页有无武装容器」、**与页面栈深无关**，故栈底页照拦（基础库 ≥2.16.0）。
//   第一次返回被拦 → beforeleave 触发 → 解武装 + 提示；2s 内再按返回时已无武装容器 → 系统正常退出；
//   2s 后自动重新武装（用户没有第二次按，说明是误触，保护恢复）。
//
// 为什么不用 wx.enableAlertBeforeUnload（**已判废·不要再搬回来**）：双死因——① 它是「返回上一页」
//   语义、绑 navigateBack/左上角原生返回按钮，tab 栈底页无上一页；② 本 app navigationStyle:custom
//   自绘导航**藏掉了它要挂的原生返回按钮**。→ 栈底页永远不弹。铁证：仓内 2026-06-14 真机存档
//   （docs/archive/调试日志-至20260616.md）早已测出「真机无弹窗」。防回潮见守卫 rw-mp-tabbar-exit-guard。
//
// 真机覆盖边界（根因#8「构建过≠真机能用」·机器守不了·须真机验）：
//   ✓ 安卓实体返回键 / 返回手势——最主要的误触退出路径，旧 uni-app 线安卓真机验证过；
//   ~ iOS 边缘侧滑退出——未证实，须真机（可能半滑卡死/白屏）；
//   ✗ 胶囊「×」/ Home 键 / 上滑杀进程 / 鸿蒙 HarmonyOS——平台无钩子，官方明说不能拦。**平台上界，非本实现缺陷。**
//
// 副作用（调用方必须知道）：武装态的 page-container 会给 Page 注入 position:fixed、冻结**页面级**滚动
//   （overlay=false 不解此锁）→ 页面内容必须套在填满视口的 <scroll-view scroll-y> 里，滚动发生在
//   scroll-view 内部（page-container 锁不到）。页面级下拉刷新（enablePullDownRefresh）同理失效，
//   须改用 <scroll-view refresher-enabled>。两条都由守卫 rw-mp-tabbar-exit-guard 焊死。
const REARM_MS = 2000
// 用「点」不用「按」：本文件在 tab 首屏字体闭包内，「按」不在 tier1 子集（改回去会咬红 rw-mp-font-tier-coverage，
// 且不重建 woff 的话真机该字掉系统字体）。语义无损——原生 toast 本就由客户端用系统字体渲染。
const EXIT_TOAST = '再点一次退出'

/** 宿主页最小形状：exitGuardArmed 驱动 <page-container show>，定时器句柄挂页面实例（每页独立·不跨页共享）。 */
type ExitGuardHost = {
  setData: (patch: Record<string, unknown>) => void
  _exitGuardTimer?: ReturnType<typeof setTimeout> | null
}

/** tabBar 页 onShow 调用：武装拦截（幂等·重复调用只是重新置位并清掉在途重武装定时器）。 */
export function armExitGuard(page: ExitGuardHost): void {
  if (page._exitGuardTimer) {
    clearTimeout(page._exitGuardTimer)
    page._exitGuardTimer = null
  }
  page.setData({ exitGuardArmed: true })
}

/** tabBar 页 onHide/onUnload 调用：清在途重武装定时器（切走本页后不该再回调已隐藏页的 setData）。 */
export function releaseExitGuard(page: ExitGuardHost): void {
  if (page._exitGuardTimer) {
    clearTimeout(page._exitGuardTimer)
    page._exitGuardTimer = null
  }
}

/** <page-container bindbeforeleave> 回调：解武装放行「再按一次」，提示后 2s 自动重新武装。 */
export function onExitGuardBeforeLeave(page: ExitGuardHost): void {
  page.setData({ exitGuardArmed: false }) // 本次返回已被消费 → 2s 内再按返回不拦、直接退出
  wx.showToast({ title: EXIT_TOAST, icon: 'none', duration: REARM_MS })
  if (page._exitGuardTimer) clearTimeout(page._exitGuardTimer)
  page._exitGuardTimer = setTimeout(() => {
    page._exitGuardTimer = null
    page.setData({ exitGuardArmed: true }) // 没等到第二次返回＝误触，保护恢复
  }, REARM_MS)
}

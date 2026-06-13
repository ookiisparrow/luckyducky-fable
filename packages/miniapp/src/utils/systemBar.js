/**
 * 系统栏尺寸（状态栏 + 微信胶囊）单一来源。
 *
 * 为什么有这个文件：原先各页顶部留白都硬编码 env(safe-area-inset-top)，但在小程序
 * （尤其安卓）这个值不可靠，且只代表状态栏、不含右上角胶囊。这里用小程序 API 动态
 * 读出真实状态栏高度与胶囊位置，让「自绘导航」能同时避开状态栏和胶囊。
 *
 * 跨端：小程序用胶囊计算；H5 / App 没有胶囊，用状态栏高度 + 固定导航高度兜底
 *      （H5 的顶部安全区仍由各页 CSS 的 env() 负责，见 CoNavBar 等）。
 * 值在启动后稳定，故模块级缓存（只算一次）。
 */

let _cache = null

export function getSystemBar() {
  if (_cache) return _cache

  // getWindowInfo 为新 API；旧基础库回退 getSystemInfoSync
  const win =
    (typeof uni.getWindowInfo === 'function' ? uni.getWindowInfo() : uni.getSystemInfoSync()) || {}
  const statusBarHeight = win.statusBarHeight || 0
  const windowWidth = win.windowWidth || 375

  let navBarHeight = 44 // 兜底：H5 / App 或取不到胶囊时的导航内容高度
  let capsuleGap = 0 // 右侧给胶囊让出的宽度（含右边距）；非小程序为 0

  // #ifdef MP-WEIXIN
  const cap =
    typeof uni.getMenuButtonBoundingClientRect === 'function'
      ? uni.getMenuButtonBoundingClientRect()
      : null
  if (cap && cap.height) {
    // 让导航内容与胶囊垂直居中：上下留白相等
    navBarHeight = (cap.top - statusBarHeight) * 2 + cap.height
    // 右侧避让：从胶囊左缘到屏幕右缘的宽度
    capsuleGap = Math.max(0, windowWidth - cap.left)
  }
  // #endif

  _cache = {
    statusBarHeight, // 状态栏高度（px）
    navBarHeight, // 导航内容区高度（px）
    navTotalHeight: statusBarHeight + navBarHeight, // 顶部总高（px）
    capsuleGap, // 右侧胶囊避让宽度（px）
  }
  return _cache
}

/**
 * 以 CSS 变量形式给出系统栏尺寸，供页面/组件 :style 注入、scoped 里 var() 取
 * （scoped 样式拿不到 JS 值，这是约定的传值通道，见 CoNavBar / 各沉浸页）。
 */
export function getSystemBarVars() {
  const bar = getSystemBar()
  return {
    '--sbh': bar.statusBarHeight + 'px',
    '--navh': bar.navBarHeight + 'px',
    '--gap': bar.capsuleGap + 'px',
  }
}

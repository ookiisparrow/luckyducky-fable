// 导航兜底单源（病根#5 Rule of Three：player/catalog/welcome 三处同款判断）。
// 自绘导航页（navigationStyle:custom）没有原生返回箭头，返回全靠自绘按钮——而这些页都可能被
// **深链直接进入**（扫码激活落 welcome/catalog、分享链落播放页），此时页面栈只有一层，
// navigateBack 会失败并把用户卡死在页内。故统一：有上级页就退回去，没有就兜底回首页 tab。

/** 返回上一页；深链无上级页时兜底回首页 tab（不留死按钮）。 */
export function goBackOrHome(): void {
  const pages = getCurrentPages()
  if (pages.length > 1) {
    wx.navigateBack()
    return
  }
  // switchTab 而非 reLaunch：首页是 tabBar 页，reLaunch 会丢掉底部导航栏（真机上表现为无 tab 的孤页）。
  wx.switchTab({
    url: '/pages/home/home',
    fail: () => {
      wx.reLaunch({ url: '/pages/home/home' }) // switchTab 失败（配置异常等）再退一步，保证一定有出路
    },
  })
}

/** 互跳页防叠栈（售后↔订单详情会反复叠栈）：逼近微信 10 层上限（≥8，留余量）改 redirectTo
 *  替换本页；否则 navigateTo，失败降级 redirectTo（不静默卡死）。 */
export function navigateOrRedirect(url: string): void {
  if (getCurrentPages().length >= 8) wx.redirectTo({ url })
  else wx.navigateTo({ url, fail: () => wx.redirectTo({ url }) })
}

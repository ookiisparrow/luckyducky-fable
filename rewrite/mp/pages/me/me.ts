// 「我」页（M2 批7 最小真化：订单/地址入口·完整个人中心随后续批）
Page({
  onShow() {
    if (typeof this.getTabBar === 'function') (this.getTabBar() as unknown as LdTabBar).setActive('me')
  },
  onOrders() {
    wx.navigateTo({ url: '/pages/order-list/order-list' })
  },
  onAddress() {
    wx.navigateTo({ url: '/pages/address/address' })
  },
})

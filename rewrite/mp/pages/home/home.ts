// 首页壳（M2 批1 打样载体）：hero + 商品占位网格。真数据接 app 网关（getProducts/getContent）随首页批落。
Page({
  data: {
    statusBarHeight: 0,
    placeholders: [1, 2, 3, 4],
  },
  onLoad() {
    const info = wx.getWindowInfo()
    this.setData({ statusBarHeight: info.statusBarHeight })
  },
  onShow() {
    if (typeof this.getTabBar === 'function') (this.getTabBar() as unknown as LdTabBar).setActive('home')
  },
})

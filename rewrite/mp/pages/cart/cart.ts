// 购物车页占位（M2 打样壳·真页随对应页面批落）
Page({
  onShow() {
    if (typeof this.getTabBar === 'function') (this.getTabBar() as unknown as LdTabBar).setActive('cart')
  },
})

// 首页（M2 批2 真数据）：内容位 hero + 商品网格。数据经 api/catalog → app 网关；
// 拿不到（网络/app 未部署）落空态不空屏，下拉重试。
import { getContent, getProducts } from '../../api/catalog'
import { mapHero, mapProducts, type HeroVM, type ProductVM } from '../../lib/mapHome'

Page({
  data: {
    statusBarHeight: 0,
    loading: true,
    loadFailed: false,
    hero: { title: '', tagline: '' } as HeroVM,
    products: [] as ProductVM[],
  },
  onLoad() {
    const info = wx.getWindowInfo()
    this.setData({ statusBarHeight: info.statusBarHeight, hero: mapHero(null) })
    void this.reload()
  },
  onShow() {
    if (typeof this.getTabBar === 'function') (this.getTabBar() as unknown as LdTabBar).setActive('home')
  },
  async onPullDownRefresh() {
    await this.reload()
    wx.stopPullDownRefresh()
  },
  async reload() {
    const [content, products] = await Promise.all([getContent(), getProducts()])
    this.setData({
      loading: false,
      hero: mapHero(content.ok ? content.home : null), // 内容拿不到→默认文案（不空屏）
      products: products.ok ? mapProducts(products.list) : [],
      loadFailed: !products.ok,
    })
  },
})

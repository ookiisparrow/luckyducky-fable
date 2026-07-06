// 首页（重设计 9 板块·M2）：Hero/品牌/特写+商品轨/信任条/拆门槛折叠/买家秀/FAQ/收尾CTA/页脚。
// 数据经 api/catalog → app 网关；内容拿不到（网络/未部署）逐块回退设计默认文案（mapHomeContent），不空屏。
// 页只编排：把原始返回交给纯函数 mapHomeContent/mapProducts，再 setData（house style·同 detail/me）。
import { getContent, getProducts } from '../../api/catalog'
import { primeProducts } from '../../lib/catalog'
import { mapHomeContent, mapProducts, type HomeContentVM, type ProductVM } from '../../lib/mapHome'

let toastTimer: ReturnType<typeof setTimeout> | null = null

Page({
  data: {
    statusBarHeight: 0,
    loading: true,
    loadFailed: false,
    content: mapHomeContent(null) as HomeContentVM, // 首帧即默认文案·不空屏
    products: [] as ProductVM[],
    openReassure: 0, // 折叠默认首条展开（设计 CollapseGroup useState(0)）
    openFaq: 0,
    showTop: false,
    toast: { show: false, text: '' },
  },
  onLoad() {
    const info = wx.getWindowInfo()
    this.setData({ statusBarHeight: info.statusBarHeight })
    void this.reload()
  },
  onShow() {
    if (typeof this.getTabBar === 'function') (this.getTabBar() as unknown as LdTabBar).setActive('home')
  },
  async onPullDownRefresh() {
    await this.reload()
    wx.stopPullDownRefresh()
  },
  onPageScroll(e: WechatMiniprogram.Page.IPageScrollOption) {
    const show = e.scrollTop > 900 // 滚过约一屏半露出「回到顶部」
    if (show !== this.data.showTop) this.setData({ showTop: show })
  },
  async reload() {
    const [content, products] = await Promise.all([getContent(), getProducts()])
    if (products.ok && Array.isArray(products.list)) primeProducts(products.list as Record<string, unknown>[]) // 详情页复用·免重拉
    this.setData({
      loading: false,
      content: mapHomeContent(content.ok ? content.home : null), // 逐块回退默认（不空屏·不半空）
      products: products.ok ? mapProducts(products.list) : [],
      loadFailed: !products.ok,
    })
  },
  toggleReassure(e: WechatMiniprogram.TouchEvent) {
    const i = Number(e.currentTarget.dataset.index)
    this.setData({ openReassure: this.data.openReassure === i ? -1 : i })
  },
  toggleFaq(e: WechatMiniprogram.TouchEvent) {
    const i = Number(e.currentTarget.dataset.index)
    this.setData({ openFaq: this.data.openFaq === i ? -1 : i })
  },
  onTapProduct(e: WechatMiniprogram.TouchEvent) {
    const id = String(e.currentTarget.dataset.id || '')
    if (id) wx.navigateTo({ url: '/pages/detail/detail?id=' + id })
  },
  onAddProduct(e: WechatMiniprogram.TouchEvent) {
    const name = String(e.currentTarget.dataset.name || '')
    this.ping('已收藏 ' + name)
  },
  toProducts() {
    wx.pageScrollTo({ selector: '#friends', duration: 320 }) // 「购买」滚到商品轨（设计 scrollToProduct）
  },
  toIntro() {
    wx.pageScrollTo({ selector: '#intro', duration: 320 }) // 搜索胶囊滚到品牌介绍（设计 scrollToIntro）
  },
  backTop() {
    wx.pageScrollTo({ scrollTop: 0, duration: 320 })
  },
  onTapFooterLink(e: WechatMiniprogram.TouchEvent) {
    const label = String(e.currentTarget.dataset.label || '')
    this.ping(label + ' · 敬请期待')
  },
  ping(text: string) {
    if (toastTimer) clearTimeout(toastTimer)
    this.setData({ toast: { show: true, text } })
    toastTimer = setTimeout(() => this.setData({ 'toast.show': false }), 1600)
  },
})

// 首页（重设计 9 板块·M2）：Hero/品牌/特写+商品轨/信任条/拆门槛折叠/买家秀/FAQ/收尾CTA/页脚。
// 数据经 api/catalog → app 网关；内容拿不到（网络/未部署）逐块回退设计默认文案（mapHomeContent），不空屏。
// 页只编排：把原始返回交给纯函数 mapHomeContent/mapProducts，再 setData（house style·同 detail/me）。
import { getContent } from '../../api/catalog'
import { getAllProducts, getProductById } from '../../lib/catalog'
import { mapHomeContent, mapProducts, type HomeContentVM, type ProductVM } from '../../lib/mapHome'
import { decideQuickAdd } from '../../lib/quickAdd'
import * as cart from '../../lib/cart'

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
  _seq: 0, // reload 代次（同 order-list 范式）：onLoad + 下拉刷新可能并发触发·丢弃被更晚 reload 取代的过期回包
  async reload() {
    const seq = ++this._seq
    // 强刷（force:true）：下拉刷新/首屏仍要最新数据，同时回填缓存供详情/购物车复用（省它们的云调用）。
    const [content, products] = await Promise.all([getContent(), getAllProducts({ force: true })])
    if (seq !== this._seq) return // 过期回包（被更晚 reload 取代）：丢弃·不覆盖较新结果
    this.setData({
      loading: false,
      content: mapHomeContent(content.ok ? content.home : null), // 逐块回退默认（不空屏·不半空）
      products: mapProducts(products),
      loadFailed: products === null,
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
  // 首页「+」快速加购（2026-07-08 用户拍板：旧假占位反馈改真加购）：单规格直加购物车、
  // 多规格跳详情选规格、原始记录取不到（缓存 miss 且网络失败）温和失败反馈——决策纯函数见 lib/quickAdd。
  async onAddProduct(e: WechatMiniprogram.TouchEvent) {
    const id = String(e.currentTarget.dataset.id || '')
    if (!id) return
    const raw = await getProductById(id)
    const decision = decideQuickAdd(raw)
    if (decision.kind === 'add') {
      cart.add(decision.payload)
      if (typeof this.getTabBar === 'function') (this.getTabBar() as unknown as LdTabBar).setActive('home') // 角标随动（同 cart.ts:24 范式）
      this.ping('已加入购物车')
    } else if (decision.kind === 'navigate') {
      wx.navigateTo({ url: '/pages/detail/detail?id=' + decision.id })
    } else {
      this.ping('商品信息获取失败，请稍后重试')
    }
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

// 首页（重设计 9 板块·M2）：Hero/品牌/特写+商品轨/信任条/拆门槛折叠/买家秀/FAQ/收尾CTA/页脚。
// 数据经 api/catalog → app 网关；内容拿不到（网络/未部署）逐块回退设计默认文案（mapHomeContent），不空屏。
// 页只编排：把原始返回交给纯函数 mapHomeContent/mapProducts，再 setData（house style·同 detail/me）。
import { getContent } from '../../api/catalog'
import { getAllProducts, getProductById } from '../../lib/catalog'
import { mapHomeContent, mapProducts, type HomeContentVM, type ProductVM } from '../../lib/mapHome'
import { decideQuickAdd } from '../../lib/quickAdd'
import * as cart from '../../lib/cart'
import { consumeHomeTop } from '../../lib/homeIntent'

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
  hidden: false, // 已切走本 tab 标记（H·完备性扫描新增）：home 是 tabBar 页，切 tab/navigateTo 只触发 onHide、
  // 实例常驻不销毁（不适用 checkout 那套 onUnload→this.unloaded 家族）——quick-add 的 await 恢复点据此判断
  // 是否还站在本页，不把迟到回包的导航/角标同步/toast 打到用户已经切走之后的当前页面上。
  onShow() {
    this.hidden = false
    if (typeof this.getTabBar === 'function') (this.getTabBar() as unknown as LdTabBar).setActive('home')
    // 兜底意图落地（我页无课/welcome先逛逛）回到顶部；正常切 tab 未置位则保留上次滚动位置（行为不变）
    if (consumeHomeTop()) wx.pageScrollTo({ scrollTop: 0, duration: 0 })
  },
  onHide() {
    this.hidden = true
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
  _addSeq: 0, // onAddProduct 代次（H3·完备性扫描新增·同 reload._seq 范式）：本页是 tabBar 页（onUnload 正常导航
  // 基本不触发，不适用 checkout 那套 this.unloaded 家族），连点不同商品「+」可并发在途——不设代际复核则更晚一次
  // 点击的结果可能被更早一次的迟到回包盖掉。切走本 tab（onHide）而非退出本页那条路见上面 hidden 字段（Round4 复审补漏）。
  // 首页「+」快速加购（2026-07-08 用户拍板：旧假占位反馈改真加购）：单规格直加购物车、
  // 多规格跳详情选规格、原始记录取不到（缓存 miss 且网络失败）温和失败反馈——决策纯函数见 lib/quickAdd。
  async onAddProduct(e: WechatMiniprogram.TouchEvent) {
    const id = String(e.currentTarget.dataset.id || '')
    if (!id) return
    const seq = ++this._addSeq
    const raw = await getProductById(id)
    if (seq !== this._addSeq) return // 过期回包（被更晚一次 onAddProduct 取代）：丢弃·不导航/不提示
    const decision = decideQuickAdd(raw)
    if (decision.kind === 'add') {
      cart.add(decision.payload) // 数据侧动作照做（用户确实点了「+」）：即便已切走本 tab 也不该丢单
      if (this.hidden) return // 已切走 home tab（H·完备性扫描新增）：角标同步/toast 是本页 UI 副作用，用户已看不到，静默跳过
      if (typeof this.getTabBar === 'function') (this.getTabBar() as unknown as LdTabBar).setActive('home') // 角标随动（同 cart.ts:24 范式）
      this.ping('已加入购物车')
    } else if (decision.kind === 'navigate') {
      if (this.hidden) return // 已切走 home tab：不把 navigateTo 打到用户已经切走之后的当前页面上
      wx.navigateTo({ url: '/pages/detail/detail?id=' + decision.id })
    } else {
      if (this.hidden) return
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
  // bug sweep II L3：页脚链接架构无 href 字段（admin 只存纯文本 label），本无法通用跳转——「关于我们」
  // 是唯一已上线且默认安装态必现的 label（/pages/about/about 已注册·me 页也有正常入口），单独映射修复
  // 默认误报「敬请期待」；其余 label 无对应页仍是合法占位（不加配置面/不引 href 机制，运营真需要再配跳转）。
  onTapFooterLink(e: WechatMiniprogram.TouchEvent) {
    const label = String(e.currentTarget.dataset.label || '')
    if (label === '关于我们') {
      wx.navigateTo({ url: '/pages/about/about' })
      return
    }
    this.ping(label + ' · 敬请期待')
  },
  ping(text: string) {
    if (toastTimer) clearTimeout(toastTimer)
    this.setData({ toast: { show: true, text } })
    toastTimer = setTimeout(() => this.setData({ 'toast.show': false }), 1600)
  },

  // 转发/朋友圈钩子（分发前置·决策§29·守卫 rw-mp-share-wired）：公开页开转发，私有页（交易/学习/隐私）
  // 刻意不加钩子＝默认不可转发。不配 imageUrl——微信默认截页面顶部真身，不造假分享图。
  onShareAppMessage() {
    return { title: '小棉鸭钩织材料包｜一针一线，钩出随身幸运物', path: '/pages/home/home' }
  },
  onShareTimeline() {
    return { title: '小棉鸭钩织材料包｜一针一线，钩出随身幸运物' }
  },
})

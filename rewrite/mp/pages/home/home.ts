// 首页（重设计 9 板块·M2）：Hero/品牌/特写+商品轨/信任条/拆门槛折叠/买家秀/FAQ/收尾CTA/页脚。
// 数据经 api/catalog → app 网关；内容拿不到（网络/未部署）逐块回退设计默认文案（mapHomeContent），不空屏。
// 页只编排：把原始返回交给纯函数 mapHomeContent/mapProducts，再 setData（house style·同 detail/me）。
import { tapHaptic } from '../../lib/haptics'
import { trackEvent } from '../../api/learning'
import { getContent } from '../../api/catalog'
import { getAllProducts, getProductById } from '../../lib/catalog'
import { mapHomeContent, mapProducts, type HomeContentVM, type ProductVM } from '../../lib/mapHome'
import { decideQuickAdd } from '../../lib/quickAdd'
import * as cart from '../../lib/cart'
import { consumeHomeTop } from '../../lib/homeIntent'
// consumeExitGuard 别名：页面方法须叫 onExitGuardBeforeLeave（wxml bindbeforeleave 绑的就是它），同名易误读成递归
import { armExitGuard, releaseExitGuard, onExitGuardBeforeLeave as consumeExitGuard } from '../../utils/exitGuard'
import { loginGate } from '../../lib/loginGate'
import { readSnapshot, writeSnapshot } from '../../lib/snapshot'
import { reportColdStart } from '../../lib/coldStart'

let toastTimer: ReturnType<typeof setTimeout> | null = null

Page({
  data: {
    statusBarHeight: 0,
    showSplash: true, // 冷启动品牌开屏：初值 true=首帧即盖上，splash（min-hold+数据就绪 race+硬上限）自撤后经 onSplashDone 置 false。
    splashReady: false, // 首屏数据就绪信号→传 <brand-splash ready>：reload 落定即置 true 放行 splash 淡出（好网络更快撤·弱网走硬上限兜底）
    // 挂 onLoad（每次冷启动一次），非 onShow——切 tab 回来/热恢复不重播（brand-splash 有界自撤守卫见 rw-mp-splash-auto-dismiss）
    loading: true,
    loadFailed: false,
    content: mapHomeContent(null) as HomeContentVM, // 首帧即默认文案·不空屏
    products: [] as ProductVM[],
    openReassure: 0, // 折叠默认首条展开（设计 CollapseGroup useState(0)）
    openFaq: 0,
    showTop: false,
    toast: { show: false, text: '' },
    exitGuardArmed: false, // 误触退出提醒（决策§30）：驱动 <page-container show>·onShow 武装（初值 false·未上屏不拦）
    // 以下三项随「整页套 scroll-view」而来（page-container 武装态冻结页面级滚动·见 utils/exitGuard）：
    refreshing: false, // <scroll-view refresher-triggered>：接管原页面级下拉刷新
    scrollInto: '', // <scroll-view scroll-into-view>：接管原 wx.pageScrollTo({selector}) 锚点跳转
    scrollAnim: true, // 本次 scroll-into-view 是否带动画（意图回顶要瞬时·点击跳转要平滑）
  },
  onReady() {
    reportColdStart() // 冷启动耗时上报（R41）：首帧就绪算 delta（仅首次·onReady 生命周期本身只触发一次+内部 reported 锁双保险）
  },
  onLoad() {
    const info = wx.getWindowInfo()
    this.setData({ statusBarHeight: info.statusBarHeight })
    // 冷启动首屏快照（SWR·批2·根因#15/#8）：上次冷启动存的首页数据即刻渲染真实内容（stale），
    // splashReady 直接置 true 放行 splash（有真内容不必等云回包）；随后 reload 拉最新覆盖（revalidate）。
    const snap = readSnapshot()
    if (snap) {
      this._hadSnapshot = true
      this.setData({
        loading: false,
        content: mapHomeContent(snap.home),
        products: mapProducts(snap.products),
        splashReady: true,
      })
    }
    void this.reload()
  },
  hidden: false, // 已切走本 tab 标记（H·完备性扫描新增）：home 是 tabBar 页，切 tab/navigateTo 只触发 onHide、
  // 实例常驻不销毁（不适用 checkout 那套 onUnload→this.unloaded 家族）——quick-add 的 await 恢复点据此判断
  // 是否还站在本页，不把迟到回包的导航/角标同步/toast 打到用户已经切走之后的当前页面上。
  onShow() {
    this.hidden = false
    armExitGuard(this) // tabBar 栈底页误触退出提醒：武装 page-container 拦第一次返回（决策§30·见 utils/exitGuard）
    if (typeof this.getTabBar === 'function') (this.getTabBar() as unknown as LdTabBar).setActive('home')
    loginGate.maybePromptOnce() // 进 App 首个落地页即软门槛弹一次登录半屏（未同意时·本会话共用一次闸·可暂不登录先逛）
    // 兜底意图落地（我页无课/welcome先逛逛）回到顶部；正常切 tab 未置位则保留上次滚动位置（行为不变）。
    // 原 wx.pageScrollTo({scrollTop:0,duration:0}) → scroll-into-view 顶部锚点（页面级滚动已被 page-container 冻结）
    if (consumeHomeTop()) this.scrollTo('top', false)
  },
  onHide() {
    this.hidden = true
    releaseExitGuard(this) // 切走本 tab：清在途重武装定时器（不回调已隐藏页的 setData）
  },
  onUnload() {
    releaseExitGuard(this)
  },
  /** <page-container bindbeforeleave>：拦下第一次返回 →「再按一次退出」（2s 内再按放行·2s 后自动重新武装）。 */
  onExitGuardBeforeLeave() {
    consumeExitGuard(this)
  },
  /** <scroll-view bindrefresherrefresh>：接管原 onPullDownRefresh（页面级下拉在 page-container 的 fixed 下失效）。 */
  async onRefresher() {
    this.setData({ refreshing: true })
    try {
      await this.reload()
    } finally {
      // 收起下拉圈（等价原 wx.stopPullDownRefresh）。必须 finally——reload 抛异常时若漏收，
      // 下拉圈永远转下去且再也刷不动，且只有真机看得见（根因#8·同 pull-refresh-stops ③ 守的病）。
      this.setData({ refreshing: false })
    }
  },
  /** <scroll-view bindscroll>：接管原 onPageScroll（阈值逻辑不变·仍只在跨阈值时 setData）。 */
  onScroll(e: WechatMiniprogram.ScrollViewScroll) {
    const show = e.detail.scrollTop > 900 // 滚过约一屏半露出「回到顶部」
    if (show !== this.data.showTop) this.setData({ showTop: show })
  },
  /**
   * 锚点滚动单源（接管原 wx.pageScrollTo·scroll-view 内它不生效）。
   * scroll-into-view 是受控属性：停留在同一个 id 时再设同值不会重复触发（比如连点两次「购买」），
   * 故先清空再设目标——清空这次 setData 落地后（回调）才设，避免同帧合并成「没变化」。
   */
  scrollTo(id: string, animate = true) {
    this.setData({ scrollAnim: animate, scrollInto: '' }, () => {
      this.setData({ scrollInto: id })
    })
  },
  _seq: 0, // reload 代次（同 order-list 范式）：onLoad + 下拉刷新可能并发触发·丢弃被更晚 reload 取代的过期回包
  _hadSnapshot: false, // onLoad 是否已用首屏快照渲染过（批2·SWR）：为 true 时网络失败不整页翻失败态（已有真内容垫着）
  async reload() {
    const seq = ++this._seq
    // 强刷（force:true）：下拉刷新/首屏仍要最新数据，同时回填缓存供详情/购物车复用（省它们的云调用）；
    // 兼任 SWR revalidate——onLoad 若已用快照渲染过（stale），这趟拉最新数据覆盖（fresh），陈旧即悄悄换新。
    const [content, products] = await Promise.all([getContent(), getAllProducts({ force: true })])
    if (seq !== this._seq) return // 过期回包（被更晚 reload 取代）：丢弃·不覆盖较新结果
    const nextContent = mapHomeContent(content.ok ? content.home : null) // 逐块回退默认（不空屏·不半空）
    // products===null（本次强刷失败）时不计算/不写入 patch.products——保留已渲染的现状不动，同 detail.ts loadRecs
    // fail-soft 范式（G1）：此前无条件 mapProducts(null)⇒[] 会把已有非空商品轨清成空，误导「上新在路上」空态。
    const nextProducts = products !== null ? mapProducts(products) : null
    const patch: Record<string, unknown> = {
      loading: false,
      // 有快照渲染时网络失败不整页翻失败态（读路径 fail-soft·已有真内容垫着·下拉重试入口仍在）；
      // 无快照（首次冷启动/清缓存）时才让失败态出面（否则空屏）。
      loadFailed: products === null && !this._hadSnapshot,
      splashReady: true, // reload 落定（成败都）即放行 splash 离场（数据就绪·race 判定见 brand-splash.shouldLeave）
    }
    // setData 前独立 diff（content 与 products 各自比·等值跳过防无谓二次渲染·SWR「拉到的与快照一致」是常态）
    if (JSON.stringify(nextContent) !== JSON.stringify(this.data.content)) patch.content = nextContent
    if (nextProducts !== null && JSON.stringify(nextProducts) !== JSON.stringify(this.data.products)) patch.products = nextProducts
    this.setData(patch)
    writeSnapshot(products, content.ok ? content.home : null) // 回写快照供下次冷启动首帧即真实内容（products=null 只写 home 半边）
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
  // 首页「+」快速加购（2026-07-08 用户拍板改真加购；2026-07-13 用户拍板：「+」统一加入购物车，多规格默认加
  // 首个规格·不再跳详情）：单规格直加、多规格加首规格、原始记录取不到（缓存 miss 且网络失败）温和失败反馈
  // ——决策纯函数见 lib/quickAdd（navigate 分支已随本次决策删除·取不到出 null）。
  async onAddProduct(e: WechatMiniprogram.TouchEvent) {
    const id = String(e.currentTarget.dataset.id || '')
    if (!id) return
    const seq = ++this._addSeq
    const raw = await getProductById(id)
    if (seq !== this._addSeq) return // 过期回包（被更晚一次 onAddProduct 取代）：丢弃·不提示
    const payload = decideQuickAdd(raw)
    if (payload) {
      cart.add(payload) // 数据侧动作照做（用户确实点了「+」）：即便已切走本 tab 也不该丢单
      trackEvent('add_to_cart', 'home', payload.id, { sku: payload.sku || '', price: payload.price }) // 电商漏斗埋点（R41）
      if (this.hidden) return // 已切走 home tab（H·完备性扫描新增）：角标同步/toast 是本页 UI 副作用，用户已看不到，静默跳过
      if (typeof this.getTabBar === 'function') (this.getTabBar() as unknown as LdTabBar).setActive('home') // 角标随动（同 cart.ts:24 范式）
      // 多规格被默认加了首规格时把规格名亮给用户（自绘 ping 不受原生 toast 字数限制）——静默替选规格必须可见
      this.ping(payload.sku ? '已加入购物车 · ' + payload.sku : '已加入购物车')
    } else {
      if (this.hidden) return
      this.ping('商品信息获取失败，请稍后重试')
    }
  },
  toProducts() {
    tapHaptic()
    this.scrollTo('friends') // 「购买」滚到商品轨（设计 scrollToProduct）
  },
  toIntro() {
    this.scrollTo('intro') // 搜索胶囊滚到品牌介绍（设计 scrollToIntro）
  },
  backTop() {
    this.scrollTo('top')
  },
  // 品牌开屏淡出结束（brand-splash 撤场后 triggerEvent('done')·撤场＝min-hold+数据就绪 race+硬上限）：撤下覆盖层露出首页。
  onSplashDone() {
    this.setData({ showSplash: false })
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

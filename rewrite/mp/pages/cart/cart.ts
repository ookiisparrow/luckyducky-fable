// 购物车页（M2 批4·批5 接结算·重设计对齐设计「待选区」）：
//   待选区＝已加购行（勾选/加减/删除/合计），下方＝推荐商品圆加号加购（设计 options 语义·真数据）。
//   核心逻辑（lib/cart 单源·结算走选中项）零改；本批只加「推荐加购/开详情」两个读侧 handler。
import { tapHaptic } from '../../lib/haptics'
import { trackEvent } from '../../api/learning'
import * as cart from '../../lib/cart'
import { prepareFromCart } from '../../lib/checkout'
import { getAllProducts } from '../../lib/catalog'
import { decideQuickAdd } from '../../lib/quickAdd'
import { mapProducts, type ProductVM } from '../../lib/mapHome'
// consumeExitGuard 别名：页面方法须叫 onExitGuardBeforeLeave（wxml bindbeforeleave 绑的就是它），同名易误读成递归
import { armExitGuard, releaseExitGuard, onExitGuardBeforeLeave as consumeExitGuard } from '../../utils/exitGuard'
import { goHomeTab } from '../../lib/homeIntent'

let allRaw: Record<string, any>[] = [] // 全商品原档（算推荐+加购取价·onLoad 拉一次）

Page({
  data: {
    statusBarHeight: 0, // 沉浸式自绘导航：内容让开状态栏（navigationStyle:custom·2026-07-16 用户需求）
    items: cart.getItems(), // 首帧走本地车，不等云目录（有货时不闪「这里还没有东西」）
    allSelected: cart.allSelected(),
    selectedCount: cart.selectedCount(),
    totalLabel: cart.selectedTotalLabel(),
    recs: [] as ProductVM[], // 未在袋中的推荐（设计「下方选品」）·目录回来再补
    exitGuardArmed: false, // 误触退出提醒（决策§30）：驱动 <page-container show>·onShow 武装（初值 false·未上屏不拦）
  },
  ready: false, // 云目录首拉完成前 onShow 不重复 refresh（onLoad 已先本地刷一屏，避免与二次 refresh 互踩）
  async onLoad() {
    this.setData({ statusBarHeight: wx.getWindowInfo().statusBarHeight }) // 沉浸式：读状态栏高度让开自绘导航
    this.refresh() // 本地车先上屏（allRaw 仍空·freshCover 回退行内 cover）
    allRaw = (await getAllProducts()) || [] // 复用首页缓存·热路径零云调用（miss 则兜底重拉一次）
    this.refresh() // 封面换新临时址 + 推荐补齐
    this.ready = true
  },
  onShow() {
    armExitGuard(this) // tabBar 栈底页误触退出提醒：放 ready 早返回之前·首建实例也需武装（决策§30·见 utils/exitGuard）
    if (!this.ready) return // 首建实例抢跑：onLoad 首拉还没完成，交给它自己的 refresh 收尾，这次 onShow 不重复刷新
    if (typeof this.getTabBar === 'function') (this.getTabBar() as unknown as LdTabBar).setActive('cart')
    this.refresh()
  },
  onHide() {
    releaseExitGuard(this) // 切走本 tab：清在途重武装定时器（不回调已隐藏页的 setData）
  },
  onUnload() {
    releaseExitGuard(this)
  },
  /** <page-container bindbeforeleave>：拦下第一次返回 →「再按一次退出」（2s 内再按放行·2s 后自动重新武装）。 */
  onExitGuardBeforeLeave() {
    consumeExitGuard(this)
  },
  refresh() {
    // 展示 cover 用 allRaw 最新值覆盖（批B 图片链提速回归：持久化 cover 是 2h 时效临时址，隔天过期挂图）；
    // 存量 cart.getItems() 仍是持久化真值，只在这层视图组装时覆盖展示字段，不改 storage 契约。
    const items = cart.getItems().map((it) => ({ ...it, cover: cart.freshCover(it, allRaw) }))
    const inCart = new Set(items.map((it) => it.id))
    this.setData({
      items,
      allSelected: cart.allSelected(),
      selectedCount: cart.selectedCount(),
      totalLabel: cart.selectedTotalLabel(),
      recs: mapProducts(allRaw.filter((p) => !inCart.has(String(p.id || p._id || '')))).slice(0, 6), // 排除已在袋中
    })
    if (typeof this.getTabBar === 'function') (this.getTabBar() as unknown as LdTabBar).setActive('cart') // 角标随动
  },
  onToggle(e: WechatMiniprogram.TouchEvent) {
    const { id, sku } = e.currentTarget.dataset as { id: string; sku: string }
    cart.toggle(id, sku)
    this.refresh()
  },
  onToggleAll() {
    cart.toggleAll()
    this.refresh()
  },
  onInc(e: WechatMiniprogram.TouchEvent) {
    const { id, sku } = e.currentTarget.dataset as { id: string; sku: string }
    cart.bump(id, 1, sku) // 相对增·读内存最新 qty（不用渲染层 data-qty）·连点不丢增量
    this.refresh()
  },
  onDec(e: WechatMiniprogram.TouchEvent) {
    const { id, sku } = e.currentTarget.dataset as { id: string; sku: string }
    cart.bump(id, -1, sku) // 相对减·钳位 ≥1（减到 1 再减不动·删行走「删除」→ 落回下方推荐）
    this.refresh()
  },
  onRemove(e: WechatMiniprogram.TouchEvent) {
    const { id, sku } = e.currentTarget.dataset as { id: string; sku: string }
    cart.remove(id, sku)
    this.refresh() // 移出袋→若是已知商品会重回下方推荐（设计 qty→0 落 options 语义）
  },
  onAddRec(e: WechatMiniprogram.TouchEvent) {
    const id = String(e.currentTarget.dataset.id || '')
    const p = allRaw.find((x) => String(x.id || x._id || '') === id)
    // 与首页「+」共用 lib/quickAdd 决策（多规格默认加首规格）：此前这里手拼 payload 不带 sku、取商品级价，
    // 同一商品在首页与推荐位各点一次「+」会各成一行（cart 行身份 id+sku 双键）且价格可能不同。
    const payload = p ? decideQuickAdd(p) : null
    if (!payload) return
    cart.add(payload)
    this.refresh()
    wx.showToast({ title: '已加入购物车', icon: 'success' })
  },
  onOpen(e: WechatMiniprogram.TouchEvent) {
    const id = String(e.currentTarget.dataset.id || '')
    if (id) wx.navigateTo({ url: '/pages/detail/detail?id=' + id })
  },
  // 空车「去逛逛」（2026-07-25 体检批 P3）：走 goHomeTab 而非 switchTab 裸调——
  // 与 welcome「先逛逛」同口径（首页回到顶部，防上次滚动位置残留造成错位观感）。
  onGoHome() {
    tapHaptic()
    goHomeTab()
  },
  onCheckout() {
    if (!this.data.selectedCount) {
      // 提示按「车里有没有东西」分流（2026-07-25 体检批 P3）：空车时说「先勾选」是句废话——
      // 根本没有可勾的东西，用户会去找那个不存在的勾选框。
      wx.showToast({ title: this.data.items.length ? '先勾选要买的宝贝' : '先挑一只喜欢的小鸭吧', icon: 'none' })
      return
    }
    tapHaptic()
    prepareFromCart() // 选中项快照进草稿（fromCart·提交成功按实际数量扣车）
    trackEvent('checkout_start', 'cart', '', { count: this.data.selectedCount }) // 电商漏斗埋点（R41）
    wx.navigateTo({ url: '/pages/checkout/checkout' })
  },
})

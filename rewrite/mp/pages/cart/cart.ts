// 购物车页（v5「字重」稿 A4）：像素小货车（车斗箱数＝已勾选行数·最多 3）+ 已加购行（勾选/加减/按住删除）+ 小计 + 结算。
//   核心逻辑在 lib/cart 单源（结算走选中项）；结算时小货车先开走、等它出画面再跳确认订单。
import { tapHaptic } from '../../lib/haptics'
import { trackEvent } from '../../api/learning'
import * as cart from '../../lib/cart'
import { createHold, type Hold } from '../../lib/hold'
import { prepareFromCart } from '../../lib/checkout'
import { getAllProducts } from '../../lib/catalog'
// consumeExitGuard 别名：页面方法须叫 onExitGuardBeforeLeave（wxml bindbeforeleave 绑的就是它），同名易误读成递归
import { armExitGuard, releaseExitGuard, onExitGuardBeforeLeave as consumeExitGuard } from '../../utils/exitGuard'
import { goHomeTab } from '../../lib/homeIntent'
import { keyDown, keyUp } from '../../lib/keyFx'
import { fxHint } from '../../lib/pxFx'
import { groundGap } from '../../lib/ground'

let allRaw: Record<string, any>[] = [] // 全商品原档（刷新封面临时址·onLoad 拉一次）
let hold: Hold | null = null // 当前按住删除的那一行（lib/hold）
const HOLD_MS = 600 // 按住多久算删除（设计稿 data-ms=600）
const cargoOf = (items: Array<{ selected: boolean }>) => Math.min(3, items.filter((it) => it.selected).length)
// 行价展示两位小数（老板拍板 1·与结算/订单一致）；price 仍是元数字，合计照旧按分累加
const withPrice = <T extends { price: number }>(it: T) => ({ ...it, priceNum: it.price.toFixed(2) })

Page({
  onKeyDown: keyDown, // v5 按键手感（lib/keyFx）
  onKeyUp: keyUp,
  data: {
    groundGap: groundGap(), // 地面线上方留白（屏高<700 用 56·UI 审查 6 问 2a）
    statusBarHeight: 0, // 沉浸式自绘导航：内容让开状态栏（navigationStyle:custom·用户需求）
    items: cart.getItems().map(withPrice), // 首帧走本地车，不等云目录（有货时不闪「这里还没有东西」）
    selectedCount: cart.selectedCount(),
    totalLabel: cart.selectedTotalLabel(),
    cargo: cargoOf(cart.getItems()), // 小货车车斗箱数（设计稿 ca.cargo：已勾选行数·最多 3 箱）
    holding: '', // 正在按住删除的行 lineId（驱动红色填充进度）
    exitGuardArmed: false, // 误触退出提醒（决策§30）：驱动 <page-container show>·onShow 武装（初值 false·未上屏不拦）
  },
  checkingOut: false, // 结算在途锁：小货车开走中 go() 返回 0 会立刻再跳一次，连点叠两个确认订单页；离开本页（onHide）/跳转失败才解锁
  async onLoad() {
    this.setData({ statusBarHeight: wx.getWindowInfo().statusBarHeight }) // 沉浸式：读状态栏高度让开自绘导航
    this.refresh() // 本地车先上屏（allRaw 仍空·freshCover 回退行内 cover）
    allRaw = (await getAllProducts()) || [] // 复用首页缓存·热路径零云调用（miss 则兜底重拉一次）
    this.refresh() // 封面换新临时址 + 按现价同步（有变动会提示）
  },
  onShow() {
    armExitGuard(this) // tabBar 栈底页误触退出提醒（决策§30·见 utils/exitGuard）
    // 云目录首拉没回来也先刷本地车（refresh 是同步的，和 onLoad 的两次 refresh 不会互踩）；末尾同步 tabBar 角标
    this.refresh()
  },
  onHide() {
    releaseExitGuard(this) // 切走本 tab：清在途重武装定时器（不回调已隐藏页的 setData）
    this.cancelHold()
    this.checkingOut = false
  },
  onUnload() {
    releaseExitGuard(this)
    this.cancelHold()
  },
  /** <page-container bindbeforeleave>：拦下第一次返回 →「再按一次退出」（2s 内再按放行·2s 后自动重新武装）。 */
  onExitGuardBeforeLeave() {
    consumeExitGuard(this)
  },
  refresh() {
    // 加购时存的价会过期（云端按现价扣）：拿到商品原档后按现价覆盖并写回本地车。不在货架的行不动，
    // 下单时云端拒单 → checkout.dropRejectedLine 点名移出（不静默丢）。
    if (allRaw.length && cart.syncPrices(allRaw)) fxHint(this, '价格有变动，已按最新价计算')
    // 展示 cover 用 allRaw 最新值覆盖（持久化 cover 是 2h 时效临时址，隔天过期挂图）；
    // 存量 cart.getItems() 仍是持久化真值，只在这层视图组装时覆盖展示字段，不改 storage 契约。
    const items = cart.getItems().map((it) => withPrice({ ...it, cover: cart.freshCover(it, allRaw) }))
    this.setData({
      items,
      selectedCount: cart.selectedCount(),
      totalLabel: cart.selectedTotalLabel(),
      cargo: cargoOf(items),
    })
    if (typeof this.getTabBar === 'function') (this.getTabBar() as unknown as LdTabBar).setActive('cart') // 角标随动
  },
  onToggle(e: WechatMiniprogram.TouchEvent) {
    const { id, sku } = e.currentTarget.dataset as { id: string; sku: string }
    cart.toggle(id, sku)
    this.refresh()
  },
  onInc(e: WechatMiniprogram.TouchEvent) {
    const { id, sku } = e.currentTarget.dataset as { id: string; sku: string }
    cart.bump(id, 1, sku) // 相对增·读内存最新 qty（不用渲染层 data-qty）·连点不丢增量
    this.refresh()
  },
  onDec(e: WechatMiniprogram.TouchEvent) {
    const { id, sku } = e.currentTarget.dataset as { id: string; sku: string }
    cart.bump(id, -1, sku) // 相对减·钳位 ≥1（减到 1 时减号换成「按住删除」）
    this.refresh()
  },
  // 数量为 1 的行：按住 0.6s 删除并提示「已删除」；松手太快提示「按住删除」（设计稿：危险操作＝浅色键+红字+长按）
  onHoldStart(e: WechatMiniprogram.TouchEvent) {
    const { line, id, sku } = e.currentTarget.dataset as { line: string; id: string; sku: string }
    this.cancelHold()
    hold = createHold(
      HOLD_MS,
      () => {
        tapHaptic()
        cart.remove(id, sku)
        this.refresh()
        fxHint(this, '已删除')
      },
      { onQuick: () => fxHint(this, '按住删除'), onChange: (v) => this.setData({ holding: v ? line : '' }) }
    )
    const t = e.touches && e.touches[0]
    hold.start(t ? t.clientX : undefined, t ? t.clientY : undefined)
  },
  // 按住时手指滑开（顺势滑列表）超过 10px 作废（lib/hold）
  onHoldMove(e: WechatMiniprogram.TouchEvent) {
    const t = e.touches[0]
    if (t) hold?.move(t.clientX, t.clientY)
  },
  onHoldEnd() {
    hold?.end()
  },
  cancelHold() {
    hold?.cancel()
  },
  onOpen(e: WechatMiniprogram.TouchEvent) {
    const id = String(e.currentTarget.dataset.id || '')
    if (id) wx.navigateTo({ url: '/pages/detail/detail?id=' + id })
  },
  // 空车「去逛逛」：走 goHomeTab 而非 switchTab 裸调——
  // 与 welcome「先逛逛」同口径（首页回到顶部，防上次滚动位置残留造成错位观感）。
  onGoHome() {
    tapHaptic()
    goHomeTab()
  },
  onCheckout() {
    if (!this.data.selectedCount) {
      // 提示按「车里有没有东西」分流：空车时说「先勾选」是句废话——
      // 根本没有可勾的东西，用户会去找那个不存在的勾选框。
      fxHint(this, this.data.items.length ? '先勾选要买的宝贝' : '先挑一只喜欢的小鸭吧')
      return
    }
    if (this.checkingOut) return
    this.checkingOut = true
    tapHaptic()
    prepareFromCart() // 选中项快照进草稿（fromCart·提交成功按实际数量扣车）
    trackEvent('checkout_start', 'cart', '', { count: this.data.selectedCount }) // 电商漏斗埋点（R41）
    // 小货车先开走（设计稿转场），出画面再跳；车没动（开走中/组件未就绪）就直接跳
    const truck = this.selectComponent('#truck') as { go?: () => number } | null
    const ms = truck && truck.go ? truck.go() : 0
    const go = () => wx.navigateTo({ url: '/pages/checkout/checkout', fail: () => (this.checkingOut = false) })
    if (ms) setTimeout(go, ms + 20)
    else go()
  },
})

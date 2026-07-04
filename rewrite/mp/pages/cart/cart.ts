// 购物车页（M2 批4·批5 接结算）：行列表/数量步进/勾选合计/删行/空态。状态单源 lib/cart，页面 onShow 全量刷新。
import * as cart from '../../lib/cart'
import { prepareFromCart } from '../../lib/checkout'

Page({
  data: {
    items: [] as ReturnType<typeof cart.getItems>,
    allSelected: false,
    selectedCount: 0,
    totalLabel: '¥0.00',
  },
  onShow() {
    if (typeof this.getTabBar === 'function') (this.getTabBar() as unknown as LdTabBar).setActive('cart')
    this.refresh()
  },
  refresh() {
    this.setData({
      items: cart.getItems(),
      allSelected: cart.allSelected(),
      selectedCount: cart.selectedCount(),
      totalLabel: cart.selectedTotalLabel(),
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
    const { id, sku, qty } = e.currentTarget.dataset as { id: string; sku: string; qty: number }
    cart.setQty(id, Number(qty) + 1, sku)
    this.refresh()
  },
  onDec(e: WechatMiniprogram.TouchEvent) {
    const { id, sku, qty } = e.currentTarget.dataset as { id: string; sku: string; qty: number }
    cart.setQty(id, Number(qty) - 1, sku) // 钳位 ≥1（减到 1 再减不动·删行走「删」）
    this.refresh()
  },
  onRemove(e: WechatMiniprogram.TouchEvent) {
    const { id, sku } = e.currentTarget.dataset as { id: string; sku: string }
    cart.remove(id, sku)
    this.refresh()
  },
  onCheckout() {
    if (!this.data.selectedCount) {
      wx.showToast({ title: '先勾选要买的宝贝', icon: 'none' })
      return
    }
    prepareFromCart() // 选中项快照进草稿（fromCart·提交成功按实际数量扣车）
    wx.navigateTo({ url: '/pages/checkout/checkout' })
  },
  onGoHome() {
    wx.switchTab({ url: '/pages/home/home' })
  },
})

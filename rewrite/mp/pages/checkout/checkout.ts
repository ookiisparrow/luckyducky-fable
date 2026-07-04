// 结算页（M2 批5）：地址 + 条目预览 + 搭配购 + 金额明细 + 提交订单。
// 提交经 app 网关 createOrder（云端定价/校验/预留库存·不信前端）；支付拉起随批6。
import * as addr from '../../lib/address'
import * as checkout from '../../lib/checkout'
import { CHECKOUT_ADDONS } from '../../lib/checkoutConst'
import { createOrder } from '../../api/orders'

Page({
  data: {
    address: null as ReturnType<typeof addr.defaultAddress>,
    items: [] as checkout.DraftLine[],
    addons: CHECKOUT_ADDONS.map((a) => ({ ...a, added: false })),
    goodsLabel: '',
    shipLabel: '',
    couponLabel: '',
    amountLabel: '',
    submitting: false,
  },
  onShow() {
    // onShow 而非 onLoad：从地址列表/编辑页返回时刷新选中地址
    this.refresh()
  },
  refresh() {
    const draft = checkout.getDraft()
    if (!draft.items.length) {
      wx.showToast({ title: '还没有要结算的商品', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 600)
      return
    }
    const s = checkout.summaryFen()
    this.setData({
      address: addr.defaultAddress(),
      items: draft.items,
      addons: CHECKOUT_ADDONS.map((a) => ({ ...a, added: draft.items.some((l) => l.id === a.id) })),
      goodsLabel: checkout.fenLabel(s.goodsFen),
      shipLabel: s.shipFen ? checkout.fenLabel(s.shipFen) : '包邮',
      couponLabel: '-' + checkout.fenLabel(s.couponFen),
      amountLabel: checkout.fenLabel(s.amountFen),
    })
  },
  onPickAddress() {
    wx.navigateTo({ url: '/pages/address/address?pick=1' })
  },
  onToggleAddon(e: WechatMiniprogram.TouchEvent) {
    checkout.toggleAddon(String(e.currentTarget.dataset.id))
    this.refresh()
  },
  async onSubmit() {
    if (this.data.submitting) return
    const a = this.data.address
    if (!a) {
      wx.showToast({ title: '请先添加收货地址', icon: 'none' })
      return
    }
    const draft = checkout.getDraft()
    this.setData({ submitting: true })
    const r = await createOrder(
      draft.items.map((l) => ({ id: l.id, sku: l.sku, qty: l.qty })),
      { name: a.name, phone: a.phone, region: a.region, detail: a.detail }
    )
    this.setData({ submitting: false })
    if (!r.ok) {
      // 云端拒单如实反馈（缺货/停售/配置缺失等·不吞错）
      const msg = String(r.error || '')
      wx.showToast({ title: msg.startsWith('OUT_OF_STOCK') ? '有商品库存不足' : '下单没成功，稍后再试', icon: 'none' })
      return
    }
    checkout.finishSubmitted() // 购物车按实际提交数量精确扣
    wx.showModal({
      title: '订单已创建',
      content: '支付功能随下一批开通，订单可在管理后台看到。',
      showCancel: false,
      success: () => wx.switchTab({ url: '/pages/home/home' }),
    })
  },
})

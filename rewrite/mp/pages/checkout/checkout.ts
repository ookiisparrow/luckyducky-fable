// 结算页（M2 批5·批6 接收银）：地址 + 条目预览 + 搭配购 + 金额明细 + 提交订单 + 拉起支付。
// 提交经 app 网关 createOrder（云端定价/校验/预留库存·不信前端）；支付参数经 mapPayResult fail-closed。
import * as addr from '../../lib/address'
import * as checkout from '../../lib/checkout'
import { CHECKOUT_ADDONS } from '../../lib/checkoutConst'
import { createOrder, pay } from '../../api/orders'
import { mapPayResult } from '../../lib/payFlow'

Page({
  data: {
    address: null as ReturnType<typeof addr.defaultAddress>,
    items: [] as Array<checkout.DraftLine & { priceNum: string }>,
    addons: CHECKOUT_ADDONS.map((a) => ({ ...a, added: false, priceNum: a.price.toFixed(2) })),
    goodsLabel: '',
    shipLabel: '',
    couponLabel: '',
    amountNum: '', // 实付金额数字（无符号·底坞/明细大字用；金额单源仍在云端/summaryFen）
    count: 0, // 合计件数（草稿含已勾搭配购·底坞展示）
    submitting: false,
  },
  backTimer: null as ReturnType<typeof setTimeout> | null,
  onUnload() {
    if (this.backTimer) clearTimeout(this.backTimer) // 空车延时返回坞清理（守卫 rw-mp-navback-timer-cleaned）
  },
  onShow() {
    // onShow 而非 onLoad：从地址列表/编辑页返回时刷新选中地址
    this.refresh()
  },
  refresh() {
    const draft = checkout.getDraft()
    if (!draft.items.length) {
      wx.showToast({ title: '还没有要结算的商品', icon: 'none' })
      if (this.backTimer) clearTimeout(this.backTimer)
      this.backTimer = setTimeout(() => wx.navigateBack(), 600)
      return
    }
    const s = checkout.summaryFen()
    this.setData({
      address: addr.defaultAddress(),
      items: draft.items.map((l) => ({ ...l, priceNum: l.price.toFixed(2) })), // 结算页两位小数（财务口径）
      addons: CHECKOUT_ADDONS.map((a) => ({ ...a, added: draft.items.some((l) => l.id === a.id), priceNum: a.price.toFixed(2) })),
      goodsLabel: checkout.fenLabel(s.goodsFen),
      shipLabel: s.shipFen ? checkout.fenLabel(s.shipFen) : '包邮',
      couponLabel: '-' + checkout.fenLabel(s.couponFen),
      amountNum: (s.amountFen / 100).toFixed(2),
      count: draft.items.reduce((n, l) => n + l.qty, 0),
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
    if (!r.ok) {
      // 云端拒单如实反馈（缺货/停售/配置缺失等·不吞错）——唯一留在本页的路径·此处才解锁重试
      this.setData({ submitting: false })
      const msg = String(r.error || '')
      wx.showToast({ title: msg.startsWith('OUT_OF_STOCK') ? '有商品库存不足' : '下单没成功，稍后再试', icon: 'none' })
      return
    }
    // 建单成功后每条后续路径都会离开结算页（redirectTo 成功页 / startPay 内 requestPayment 成功→成功页、取消/失败→switchTab 首页），
    // submitting 保持锁定不复位——防「支付发起期间草稿已被 finishSubmitted 清空、第二次点击绕过守卫再 createOrder」（病根#1 双提交）。
    const amountFen = checkout.summaryFen().amountFen // 捕获实付分（finishSubmitted 消费草稿前）·透传成功页展示用
    checkout.finishSubmitted() // 购物车按实际提交数量精确扣
    const order = (r.order || {}) as Record<string, any>
    if (order.status === 'paid') {
      // mock 模式建单即付（开发环境）——直接进成功页
      wx.redirectTo({ url: '/pages/paysuccess/paysuccess?id=' + order.id + '&amount=' + amountFen })
      return
    }
    await this.startPay(String(order.id || ''), amountFen)
  },
  async startPay(orderId: string, amountFen: number) {
    const outcome = mapPayResult(await pay(orderId))
    if (outcome.kind === 'paid') {
      wx.redirectTo({ url: '/pages/paysuccess/paysuccess?id=' + orderId + '&amount=' + amountFen })
      return
    }
    if (outcome.kind === 'request') {
      wx.requestPayment({
        ...outcome.payment,
        success: () => wx.redirectTo({ url: '/pages/paysuccess/paysuccess?id=' + orderId + '&amount=' + amountFen }),
        fail: (res) => {
          // 取消/失败：订单保留待支付（支付窗口内可续付·订单列表随下一批开通）
          const cancelled = String(res.errMsg || '').includes('cancel')
          wx.showModal({
            title: cancelled ? '支付已取消' : '支付没成功',
            content: '订单已保留，超时前都可以继续支付。订单页随下一批开通。',
            showCancel: false,
            success: () => wx.switchTab({ url: '/pages/home/home' }),
          })
        },
      })
      return
    }
    wx.showModal({
      title: outcome.kind === 'closed' ? '订单已关闭' : '支付没成功',
      content: outcome.message,
      showCancel: false,
      success: () => wx.switchTab({ url: '/pages/home/home' }),
    })
  },
})

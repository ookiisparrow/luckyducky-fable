// 订单详情（M2 批7）：状态横幅/条目/地址/金额明细/操作（续付·确认收货·售后入口批8）。
import { getOrderById, pay, confirmReceive } from '../../api/orders'
import { mapPayResult } from '../../lib/payFlow'
import { mapOrder, type OrderVM } from '../../lib/mapOrders'

Page({
  data: {
    loading: true,
    missing: false,
    vm: null as OrderVM | null,
  },
  onLoad(query: Record<string, string | undefined>) {
    this.orderId = String(query.id || '')
  },
  orderId: '',
  onShow() {
    void this.reload()
  },
  async reload() {
    const r = await getOrderById(this.orderId)
    const vm = r.ok ? mapOrder(r.order) : null
    this.setData({ loading: false, missing: !vm, vm })
  },
  async onPay() {
    const outcome = mapPayResult(await pay(this.orderId))
    if (outcome.kind === 'paid') {
      wx.showToast({ title: '已支付', icon: 'success' })
      void this.reload()
      return
    }
    if (outcome.kind === 'request') {
      wx.requestPayment({
        ...outcome.payment,
        success: () => {
          wx.showToast({ title: '支付成功', icon: 'success' })
          void this.reload()
        },
        fail: () => void this.reload(),
      })
      return
    }
    wx.showToast({ title: outcome.message, icon: 'none' })
    void this.reload()
  },
  onConfirm() {
    wx.showModal({
      title: '确认收货',
      content: '确认已收到宝贝了吗？',
      success: async (res) => {
        if (!res.confirm) return
        const r = await confirmReceive(this.orderId)
        wx.showToast({ title: r.ok ? '已确认收货' : '操作没成功，稍后再试', icon: r.ok ? 'success' : 'none' })
        void this.reload()
      },
    })
  },
  onAfterSale() {
    wx.showToast({ title: '售后申请随下一批开通', icon: 'none' })
  },
})

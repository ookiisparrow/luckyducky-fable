// 订单详情（M2 批7·批8 接售后）：状态横幅/条目/地址/金额明细/操作（续付·确认收货·申请售后）。
import { getOrderById, pay, confirmReceive, applyRefund, getMyAfterSales } from '../../api/orders'
import { mapPayResult } from '../../lib/payFlow'
import { mapOrder, type OrderVM } from '../../lib/mapOrders'
import { applicableLines, mapAfterSales } from '../../lib/mapAftersales'

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
  onWriteReview(e: WechatMiniprogram.TouchEvent) {
    const { lineid, name } = e.currentTarget.dataset as { lineid: string; name: string }
    wx.navigateTo({ url: `/pages/review/review?orderId=${this.orderId}&lineId=${lineid}&name=${encodeURIComponent(name || '')}` })
  },
  async onAfterSale() {
    const vm = this.data.vm
    if (!vm) return
    // 该单已申请过的行（入口收窄·最终裁决在云端）：从我的售后里筛本单
    const asRes = await getMyAfterSales()
    const appliedIds = asRes.ok ? mapAfterSales(asRes.list).filter((a) => a.orderId === vm.id).map((a) => a.lineId) : []
    const eligible = applicableLines(vm.status, vm.items, appliedIds)
    if (!eligible.length) {
      wx.showToast({ title: '没有可申请售后的条目', icon: 'none' })
      return
    }
    wx.showActionSheet({
      itemList: eligible.slice(0, 6).map((l) => `${l.name}${l.spec ? '（' + l.spec + '）' : ''}`),
      success: (res) => {
        const line = eligible[res.tapIndex]
        wx.showModal({
          title: '申请退款',
          editable: true,
          placeholderText: '退款原因（选填）',
          success: async (m) => {
            if (!m.confirm) return
            const r = await applyRefund(vm.id, line.lineId, String(m.content || ''))
            if (r.ok) {
              wx.showToast({ title: '已提交申请', icon: 'success' })
              wx.navigateTo({ url: '/pages/aftersales/aftersales' })
            } else {
              const e = String(r.error || '')
              const msg = e === 'ALREADY_APPLIED' ? '这条已申请过了' : e === 'NOT_REFUNDABLE' ? '该条目不可退（已开课）' : e === 'NOTHING_LEFT' ? '本单可退额度已用完' : '申请没成功，稍后再试'
              wx.showToast({ title: msg, icon: 'none' })
            }
          },
        })
      },
    })
  },
})

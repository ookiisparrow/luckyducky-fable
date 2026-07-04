// 支付成功页（M2 批6）：轻确认 + 双出口（回首页 / 看订单——订单列表随下一批开通）。
Page({
  data: { orderId: '' },
  onLoad(query: Record<string, string | undefined>) {
    this.setData({ orderId: String(query.id || '') })
  },
  onGoHome() {
    wx.switchTab({ url: '/pages/home/home' })
  },
  onViewOrder() {
    if (this.data.orderId) wx.redirectTo({ url: '/pages/order/order?id=' + this.data.orderId })
    else wx.redirectTo({ url: '/pages/order-list/order-list' })
  },
})

// 支付成功页（M2 批6·换皮到设计 cosuc）：英雄对勾 + 实付金额 + 订单信息 + 双出口。
// 实付金额来自 checkout 拉起支付时透传的实付分（?amount=fen·钱链单源在云端/checkout·此处仅展示）；
// 缺 amount（旧链路/异常）则隐去金额行、绝不写死。出口逻辑（回首页/看订单）保持不变。
Page({
  data: { orderId: '', amountYuan: '', hasAmount: false },
  onLoad(query: Record<string, string | undefined>) {
    const orderId = String(query.id || '')
    let amountYuan = ''
    let hasAmount = false
    const raw = query.amount
    if (raw != null && raw !== '') {
      const fen = Number(raw)
      if (Number.isFinite(fen) && fen >= 0) {
        amountYuan = (fen / 100).toFixed(2)
        hasAmount = true
      }
    }
    this.setData({ orderId, amountYuan, hasAmount })
  },
  onGoHome() {
    wx.switchTab({ url: '/pages/home/home' })
  },
  onViewOrder() {
    if (this.data.orderId) wx.redirectTo({ url: '/pages/order/order?id=' + this.data.orderId })
    else wx.redirectTo({ url: '/pages/order-list/order-list' })
  },
})

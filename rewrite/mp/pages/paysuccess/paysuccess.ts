// 支付成功页（v5「字重」稿 A8）：像素金币 + 支付成功 + 实付金额 + 履约口径 + 双出口。
// 实付金额来自 checkout 拉起支付时透传的实付分（?amount=fen·钱链单源在云端/checkout·此处仅展示）；
// 缺 amount（异常）则隐去金额行、绝不写死。
import { tapHaptic } from '../../lib/haptics'
import { trackEvent } from '../../api/learning'
import { goHomeTab } from '../../lib/homeIntent'
import { keyDown, keyUp } from '../../lib/keyFx'

Page({
  onKeyDown: keyDown, // v5 按键手感（lib/keyFx）
  onKeyUp: keyUp,
  data: { orderId: '', amountYuan: '', hasAmount: false },
  onLoad(query: Record<string, string | undefined>) {
    const orderId = String(query.id || '')
    const fen = query.amount ? Number(query.amount) : NaN // 缺/空串 → NaN → 隐去金额行
    const hasAmount = Number.isFinite(fen) && fen >= 0
    const amountYuan = hasAmount ? (fen / 100).toFixed(2) : ''
    this.setData({ orderId, amountYuan, hasAmount })
    trackEvent('pay_success_view', 'paysuccess', orderId, { amountYuan, hasAmount }) // 电商漏斗埋点（R41）
  },
  onGoHome() {
    tapHaptic()
    // 回首页从头逛起：防 tab 实例旧滚动位置残留（同 me/welcome 兜底出口范式，收敛见 lib/homeIntent.ts）
    goHomeTab()
  },
  onViewOrder() {
    if (this.data.orderId) wx.redirectTo({ url: '/pages/order/order?id=' + this.data.orderId })
    else wx.redirectTo({ url: '/pages/order-list/order-list' })
  },
})

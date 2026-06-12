// 发起支付（敏感业务：金额一律取库内订单 amount，不信任前端）。
// 云调用 cloudPay.unifiedOrder：商户号在云开发控制台关联后写进 config.pay.subMchId；
// 支付结果回调走 payCallback 云函数（云开发可信通道，免验签）。
// PAY_MODE=real 且商户号配置齐全才放行（缺省 mock 下本函数不可用，防误启用）。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// 待支付有效期，与 closeExpiredOrders 定时关单、前端倒计时同口径
const EXPIRE_MS = 15 * 60 * 1000

exports.main = async (event) => {
  const { OPENID, ENV } = cloud.getWXContext()
  if (!OPENID) return { ok: false, error: 'NO_OPENID' }
  const id = String(event.id || '')
  if (!id) return { ok: false, error: 'NO_ID' }

  const got = await db.collection('orders').doc(id).get().catch(() => null)
  if (!got || !got.data || got.data._openid !== OPENID) return { ok: false, error: 'NOT_FOUND' }
  const order = got.data
  if (order.status !== 'pending') return { ok: false, error: 'BAD_STATUS:' + order.status }

  // 惰性超时：到点的 pending 当场关闭（定时器只是兜底，不依赖其节拍）
  if (Date.now() - order.createdAt > EXPIRE_MS) {
    await db.collection('orders').doc(id).update({ data: { status: 'closed', closedAt: Date.now() } })
    return { ok: false, error: 'ORDER_CLOSED' }
  }

  const cfg = await db.collection('config').doc('pay').get().catch(() => null)
  const pay = (cfg && cfg.data) || {}
  if (pay.mode !== 'real' || !pay.subMchId) return { ok: false, error: 'PAY_NOT_ENABLED' }

  const totalFee = Math.round(order.amount * 100) // 微信支付单位是分
  if (totalFee <= 0) {
    // 0 元单（占位券抵扣到 0）：无费可付，直接置已支付（微信支付最低 1 分）
    const paidAt = Date.now()
    await db.collection('orders').doc(id).update({ data: { status: 'paid', paidAt } })
    return { ok: true, paid: true, paidAt }
  }

  const firstName = order.items && order.items[0] ? String(order.items[0].name) : '钩织材料包'
  const res = await cloud.cloudPay.unifiedOrder({
    body: ('幸运小鸭 · ' + firstName).slice(0, 40),
    outTradeNo: order.id,
    spbillCreateIp: '127.0.0.1',
    subMchId: String(pay.subMchId),
    totalFee,
    envId: ENV,
    functionName: 'payCallback',
  })
  if (!res || !res.payment) {
    console.error('[pay] unifiedOrder 失败', order.id, res && res.returnMsg)
    return { ok: false, error: 'UNIFIED_ORDER_FAIL' }
  }
  // payment 即 wx.requestPayment 所需参数（timeStamp/nonceStr/package/signType/paySign）
  return { ok: true, payment: res.payment }
}

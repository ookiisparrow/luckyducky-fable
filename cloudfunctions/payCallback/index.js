// 支付结果回调（微信 → 云函数可信通道，免验签；函数名在 pay 的 unifiedOrder 里指定）。
// 幂等：pending → paid 只生效一次；paid/shipped/done 上的重复通知静默确认。
// closed 后回调到达（用户卡着 15 分钟点支付、关单先发生）：钱已收，订单复活置 paid。
// 协议：必须返回 { errcode: 0 } 告知微信已收到，否则微信会重试推送。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const ACK = { errcode: 0, errmsg: 'OK' }

exports.main = async (event) => {
  const outTradeNo = String(event.outTradeNo || '')
  if (!outTradeNo) return ACK
  // 未成功的通知不改状态（取消/失败单留在 pending，等用户重付或超时关单）
  if (event.returnCode !== 'SUCCESS' || event.resultCode !== 'SUCCESS') return ACK

  const got = await db.collection('orders').doc(outTradeNo).get().catch(() => null)
  if (!got || !got.data) {
    console.error('[payCallback] 收到未知订单号的成功通知', outTradeNo)
    return ACK // 重试也无单可改，确认收到并留日志人工排查
  }
  const order = got.data

  if (order.status === 'pending' || order.status === 'closed') {
    const paidAt = Date.now()
    const patch = { status: 'paid', paidAt, transactionId: String(event.transactionId || '') }
    if (Number(event.totalFee) !== Math.round(order.amount * 100)) {
      patch.feeMismatch = true // 金额不符不该发生（unifiedOrder 用的就是库内金额），留痕人工对账
      console.error('[payCallback] 金额不符', outTradeNo, event.totalFee, order.amount)
    }
    await db.collection('orders').doc(outTradeNo).update({ data: patch })
  }
  return ACK
}

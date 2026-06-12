// 支付结果回调（微信 → paynotify 工作流 → 本函数；工作流通道可信，解密已由平台完成）。
// 入参兼容两种形态：v3 工作流回调的 resource（out_trade_no/trade_state/transaction_id/amount）
// 与旧 v2 字段（outTradeNo/resultCode/totalFee/transactionId），归一化后同一套幂等逻辑。
// 幂等：pending → paid 只生效一次；paid/shipped/done 上的重复通知静默确认。
// closed 后回调到达（用户卡着 15 分钟点支付、关单先发生）：钱已收，订单复活置 paid。
// 协议：返回 { errcode: 0 } 告知已收到，否则微信会重试推送。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const ACK = { errcode: 0, errmsg: 'OK' }

exports.main = async (event) => {
  // 防伪闸（审核批次A-1）：本函数只应由 paynotify 工作流服务端调用（无用户上下文）。
  // 小程序客户端 callFunction 必带 OPENID——带用户身份的调用一律视为伪造，拒改状态。
  const { OPENID } = cloud.getWXContext()
  if (OPENID) {
    console.error('[payCallback] 拒绝带用户身份的调用（疑似客户端伪造）', OPENID)
    return ACK
  }
  const e = event || {}
  // 归一化 v3 / v2 两种通知形态
  const outTradeNo = String(e.out_trade_no || e.outTradeNo || '')
  const success =
    e.trade_state === 'SUCCESS' || (e.returnCode === 'SUCCESS' && e.resultCode === 'SUCCESS')
  const paidFee =
    e.amount && e.amount.payer_total != null
      ? Number(e.amount.payer_total)
      : e.amount && e.amount.total != null
        ? Number(e.amount.total)
        : Number(e.totalFee)
  const transactionId = String(e.transaction_id || e.transactionId || '')

  if (!outTradeNo) return ACK
  // 未成功的通知不改状态（取消/失败单留在 pending，等用户重付或超时关单）
  if (!success) return ACK

  const got = await db.collection('orders').doc(outTradeNo).get().catch(() => null)
  if (!got || !got.data) {
    console.error('[payCallback] 收到未知订单号的成功通知', outTradeNo)
    return ACK // 重试也无单可改，确认收到并留日志人工排查
  }
  const order = got.data

  if (order.status === 'pending' || order.status === 'closed') {
    const paidAt = Date.now()
    const patch = { status: 'paid', paidAt, transactionId }
    if (paidFee !== Math.round(order.amount * 100)) {
      patch.feeMismatch = true // 金额不符不该发生（下单用的就是库内金额），留痕人工对账
      console.error('[payCallback] 金额不符', outTradeNo, paidFee, order.amount)
    }
    await db.collection('orders').doc(outTradeNo).update({ data: patch })
  }
  return ACK
}

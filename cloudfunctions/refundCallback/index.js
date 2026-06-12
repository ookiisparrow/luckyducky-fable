// 退款结果回调（微信 → refundnotify 工作流 → 本函数；通道可信，解密已由平台完成）。
// v3 退款通知 resource：{ out_refund_no, out_trade_no, refund_status, transaction_id, amount:{refund,...} }
// 幂等：applied/approved → refunded 只生效一次；其余状态上的重复通知静默确认。
// 退款成功同时在订单上留痕（refunded.<productId> = 金额，详情展示与对账用）。
// 协议：返回 { errcode: 0 } 告知已收到，否则微信会重试推送。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const ACK = { errcode: 0, errmsg: 'OK' }

exports.main = async (event) => {
  // 防伪闸（审核批次A-1）：只应由 refundnotify 工作流服务端调用；带用户身份=客户端伪造，拒改状态。
  const { OPENID } = cloud.getWXContext()
  if (OPENID) {
    console.error('[refundCallback] 拒绝带用户身份的调用（疑似客户端伪造）', OPENID)
    return ACK
  }
  const e = event || {}
  const outRefundNo = String(e.out_refund_no || '')
  if (!outRefundNo) return ACK

  const got = await db.collection('afterSales').doc(outRefundNo).get().catch(() => null)
  if (!got || !got.data) {
    console.error('[refundCallback] 收到未知售后单的退款通知', outRefundNo)
    return ACK
  }
  const as = got.data
  const status = String(e.refund_status || '')

  // 核验（审核批次A-3，fail-closed）：成功通知的订单号与退款金额必须与售后单一致，
  // 否则不置已退款、留 refundMismatch 痕等人工（商户平台核对流水后处理）。
  const claimFee = e.amount && e.amount.refund != null ? Number(e.amount.refund) : NaN
  if (
    status === 'SUCCESS' &&
    (String(e.out_trade_no || '') !== String(as.orderId) || claimFee !== Math.round(as.refundAmount * 100))
  ) {
    console.error('[refundCallback] 成功通知与售后单不符，拒置已退款', outRefundNo, e.out_trade_no, claimFee)
    await db.collection('afterSales').doc(outRefundNo).update({ data: { refundMismatch: true } }).catch(() => {})
    return ACK
  }

  if (status !== 'SUCCESS') {
    // 退款异常（CLOSED/ABNORMAL 等）：留痕人工处理（商户平台可手动重试），不翻状态
    console.error('[refundCallback] 非成功退款通知', outRefundNo, status)
    await db.collection('afterSales').doc(outRefundNo).update({ data: { refundStatus: status } }).catch(() => {})
    return ACK
  }

  if (as.status === 'applied' || as.status === 'approved') {
    await db.collection('afterSales').doc(outRefundNo).update({
      data: {
        status: 'refunded',
        refundedAt: Date.now(),
        refundTransactionId: String(e.transaction_id || ''),
      },
    })
    // 订单留痕（失败不阻塞 ACK：售后单是退款状态的单一来源）
    await db
      .collection('orders')
      .doc(as.orderId)
      .update({ data: { ['refunded.' + as.productId]: as.refundAmount } })
      .catch(() => {})
  }
  return ACK
}

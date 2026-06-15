import { toFen } from '@luckyducky/shared'
import { defineNotifyCallback, alert } from '../../kit'

// 退款结果回调（微信 → refundnotify 工作流 → 本函数）。防伪闸 + ACK + id 提取由 kit 收编。
// v3 退款 resource：{ out_refund_no, out_trade_no, refund_status, transaction_id, amount:{refund} }。
// 幂等：applied/approved → refunded 只一次；核验 fail-closed（订单号+金额须一致，否则留 refundMismatch 痕）；
// 非成功留 refundStatus 痕不翻状态；成功在订单留 refunded.<productId> 痕（详情/对账用）。
const ACK = { errcode: 0, errmsg: 'OK' }

export const main = defineNotifyCallback<any>({
  ack: ACK,
  refId: (e) => String(e.out_refund_no || ''),
  onNotify: async ({ db, id, event: e }) => {
    const got = await db.collection('afterSales').doc(id).get().catch(() => null)
    if (!got || !got.data) {
      alert('money', 'refundCallback', 'UNKNOWN_AFTERSALE', { id }) // 退款通知无对应售后单（债#23）
      return
    }
    const as = got.data
    const status = String(e.refund_status || '')
    const claimFee = e.amount && e.amount.refund != null ? Number(e.amount.refund) : NaN

    // 核验 fail-closed（审核批次A-3）：成功通知的订单号与退款金额须与售后单一致，否则不置已退款
    if (
      status === 'SUCCESS' &&
      (String(e.out_trade_no || '') !== String(as.orderId) ||
        claimFee !== toFen(as.refundAmount))
    ) {
      alert('money', 'refundCallback', 'MISMATCH', { id, outTradeNo: String(e.out_trade_no || ''), claimFee }) // 单号/金额不符·拒置已退款（债#23）
      await db.collection('afterSales').doc(id).update({ data: { refundMismatch: true } }).catch(() => {})
      return
    }
    if (status !== 'SUCCESS') {
      // 退款异常（CLOSED/ABNORMAL 等）：留痕人工处理，不翻状态——退款没成功须告警（债#23）
      alert('money', 'refundCallback', 'NOT_SUCCESS', { id, status })
      await db.collection('afterSales').doc(id).update({ data: { refundStatus: status } }).catch(() => {})
      return
    }
    if (as.status === 'applied' || as.status === 'approved') {
      await db.collection('afterSales').doc(id).update({
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
  },
})

import { toFen } from '@luckyducky/shared'
import { defineNotifyCallback, transition } from '../../kit'

// 支付结果回调（微信 → paynotify 工作流 → 本函数；工作流通道可信，解密已由平台完成）。
// 防伪闸 + ACK 协议 + id 提取由 kit.defineNotifyCallback 收编（与 refundCallback 共享外壳）；
// 本函数只写「订单 pending/closed → paid」。入参兼容 v3 resource 与旧 v2 字段。
const ACK = { errcode: 0, errmsg: 'OK' }

export const main = defineNotifyCallback<any>({
  ack: ACK,
  refId: (e) => String(e.out_trade_no || e.outTradeNo || ''),
  onNotify: async ({ id, event: e }) => {
    const success =
      e.trade_state === 'SUCCESS' || (e.returnCode === 'SUCCESS' && e.resultCode === 'SUCCESS')
    if (!success) return // 未成功：留 pending（取消/失败单等用户重付或超时关单）
    const paidFee =
      e.amount && e.amount.payer_total != null
        ? Number(e.amount.payer_total)
        : e.amount && e.amount.total != null
          ? Number(e.amount.total)
          : Number(e.totalFee)
    const transactionId = String(e.transaction_id || e.transactionId || '')
    // 幂等条件流转 pending|closed → paid（closed 后钱到账，订单复活）。金额不符留 feeMismatch 痕。
    const { moved, doc } = await transition('orders', id, ['pending', 'closed'], 'paid', (order) => {
      const patch: Record<string, unknown> = { paidAt: Date.now(), transactionId }
      if (paidFee !== toFen(order.amount)) {
        patch.feeMismatch = true
        console.error('[payCallback] 金额不符', id, paidFee, order.amount)
      }
      return patch
    })
    if (!doc) console.error('[payCallback] 收到未知订单号的成功通知', id)
    void moved // paid/shipped/done 上的重复通知：moved=false，幂等 no-op
  },
})

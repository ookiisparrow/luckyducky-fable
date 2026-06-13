import { defineNotifyCallback, transition } from '../../kit'

// 支付结果回调（微信 → paynotify 工作流 → 本函数；工作流通道可信，解密已由平台完成）。
// 试点：防伪闸 + ACK 协议 + 幂等骨架由 kit.defineNotifyCallback 收编（与 refundCallback 70% 重复，
// B4 一并收）；本函数只写「订单 pending/closed → paid」的特定逻辑。
// 入参兼容 v3 工作流 resource（out_trade_no/trade_state/transaction_id/amount）与旧 v2 字段。
const ACK = { errcode: 0, errmsg: 'OK' }

export const main = defineNotifyCallback<any>({
  ack: ACK,
  parse: (e) => {
    const id = String(e.out_trade_no || e.outTradeNo || '')
    const success =
      e.trade_state === 'SUCCESS' || (e.returnCode === 'SUCCESS' && e.resultCode === 'SUCCESS')
    return id ? { id, success } : null
  },
  onSuccess: async ({ id, event: e }) => {
    const paidFee =
      e.amount && e.amount.payer_total != null
        ? Number(e.amount.payer_total)
        : e.amount && e.amount.total != null
          ? Number(e.amount.total)
          : Number(e.totalFee)
    const transactionId = String(e.transaction_id || e.transactionId || '')
    // 幂等条件流转 pending|closed → paid（closed 后钱到账，订单复活）。
    // 金额不符不该发生（下单用的就是库内金额）：照常 paid 但留 feeMismatch 痕人工对账。
    const { moved, doc } = await transition('orders', id, ['pending', 'closed'], 'paid', (order) => {
      const patch: Record<string, unknown> = { paidAt: Date.now(), transactionId }
      if (paidFee !== Math.round(order.amount * 100)) {
        patch.feeMismatch = true
        console.error('[payCallback] 金额不符', id, paidFee, order.amount)
      }
      return patch
    })
    if (!doc) console.error('[payCallback] 收到未知订单号的成功通知', id)
    void moved // paid/shipped/done 上的重复通知：moved=false，幂等 no-op
  },
})

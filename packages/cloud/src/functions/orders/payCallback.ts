import { toFen } from '@luckyducky/shared'
import {
  defineNotifyCallback,
  transition,
  alert,
  notifyAlert,
  reserveStock,
  restoreStock,
} from '../../kit'

// 支付结果回调（微信 → paynotify 工作流 → 本函数；工作流通道可信，解密已由平台完成）。
// 防伪闸 + ACK 协议 + id 提取由 kit.defineNotifyCallback 收编（与 refundCallback 共享外壳）。
// 本函数写「订单 → paid」：
//   · pending → paid：库存自下单起一直持有，直接翻单。
//   · closed → paid：超时关单时库存已**回补**，故复活前须**重新 CAS 抢回 reserved 库存**才翻 paid；
//                    抢不到（已被别人买走）→ 进 refund_required 待退款态（钱已收·无法履约·告警人工退款），
//                    杜绝「关单回补 + 晚到回调」双单争一份库存的超卖（审核 P0·根因#1/#2·守卫 paycallback-revive-reserves-stock）。
// 入参兼容 v3 resource 与旧 v2 字段。
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
    // paid 痕 + 金额核对（pending 翻单 / closed 复活共用）：金额不符照翻 paid（钱已到账）只留 feeMismatch 痕
    // + 告警人工对账（债#23）——平台已当成功，静默语义失败不能丢。
    const payPatch = (order: Record<string, unknown>): Record<string, unknown> => {
      const patch: Record<string, unknown> = { paidAt: Date.now(), transactionId }
      if (paidFee !== toFen(order.amount as number)) {
        patch.feeMismatch = true
        alert('money', 'payCallback', 'FEE_MISMATCH', { id, paidFee, expectFen: toFen(order.amount as number) })
      }
      return patch
    }

    // 正常路径：pending → paid（库存自下单一直持有·无需重抢）
    const p = await transition('orders', id, ['pending'], 'paid', payPatch)
    if (p.moved) return // 翻单成功
    if (!p.doc) return void (await notifyAlert('money', 'payCallback', 'UNKNOWN_ORDER', { id })) // 收钱无单·告警+推送（债#23续）
    if (p.doc.status !== 'closed') return // 已 paid/shipped/done：重复通知幂等 no-op

    // 关单后晚到的成功回调：库存已在关单时回补，须重抢回 reserved 才可复活（否则与已买走的 B 单超卖·审核 P0）。
    const reserved = Array.isArray(p.doc.reserved) ? p.doc.reserved : []
    const re = await reserveStock(reserved)
    if (re.ok) {
      // 抢回库存（含 reserved 为空/不限量）→ closed → paid 复活（绑本次转移·幂等）
      const c = await transition('orders', id, ['closed'], 'paid', (order) => ({
        ...payPatch(order),
        revivedAt: Date.now(),
      }))
      if (!c.moved) await restoreStock(re.reserved) // 并发已被别的回调复活：把刚抢的还回去·防双扣
    } else {
      // 库存已被买走·无法履约：钱已收 → refund_required 待退款态（不超卖·不静默吞钱），告警人工退款
      const rr = await transition('orders', id, ['closed'], 'refund_required', {
        feeReceivedAt: Date.now(),
        transactionId,
        paidFee,
      })
      if (rr.moved) await notifyAlert('money', 'payCallback', 'PAID_BUT_OOS', { id, transactionId, paidFee })
    }
  },
})

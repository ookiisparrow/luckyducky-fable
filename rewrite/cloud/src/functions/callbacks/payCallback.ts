import { toFen, COLLECTIONS } from '@ldrw/shared'
import { defineNotifyCallback, transition, alert, notifyAlert, reserveStock, restoreStock, getDb } from '../../kit'

// 支付结果回调（黄金 orders-money·payCallback 节全量）。防伪/ACK/id 提取由 defineNotifyCallback 强制。
// pending→paid 直接翻单（库存自下单持有）；closed→paid 复活前必须重抢库存——抢不到进 refund_required
// （钱已收无法履约·告警人工退款·绝不超卖）。入参兼容 v3 resource 与旧 v2 字段。
// 部署命名：M5 切换日同名替换（回调点位绑定控制台工作流 paynotify）。
const ACK = { errcode: 0, errmsg: 'OK' }

/**
 * 关单回补与晚到回调的竞态缓冲：关单是「先原子转 closed、再回补」两步（跨集合非原子），
 * 晚到回调若卡在「已 closed 但回补未落定」瞬时窗会误判售罄——短暂重试即成功；
 * 真被别人买走则重试仍失败 → refund_required（错向安全侧·不超卖）。sleep 可注入便于单测。
 */
export async function reserveWithRetry(
  reserve: () => Promise<{ ok: boolean; reserved: any[] }>,
  opts: { tries?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> } = {}
): Promise<{ ok: boolean; reserved: any[] }> {
  const tries = opts.tries ?? 3
  const delayMs = opts.delayMs ?? 200
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  let res = await reserve()
  for (let i = 1; i < tries && !res.ok; i++) {
    await sleep(delayMs)
    res = await reserve()
  }
  return res
}

export const main = defineNotifyCallback<any>({
  ack: ACK,
  refId: (e) => String(e.out_trade_no || e.outTradeNo || ''),
  onNotify: async ({ id, event: e }) => {
    const success = e.trade_state === 'SUCCESS' || (e.returnCode === 'SUCCESS' && e.resultCode === 'SUCCESS')
    if (!success) return // 未成功：留 pending（等重付或超时关单）
    const paidFee =
      e.amount && e.amount.payer_total != null
        ? Number(e.amount.payer_total)
        : e.amount && e.amount.total != null
          ? Number(e.amount.total)
          : Number(e.totalFee)
    const transactionId = String(e.transaction_id || e.transactionId || '')
    // 金额不符照翻 paid（钱已到账）只留 feeMismatch 痕 + 告警人工对账——静默语义失败不能丢
    const payPatch = (order: Record<string, unknown>): Record<string, unknown> => {
      const patch: Record<string, unknown> = { paidAt: Date.now(), transactionId }
      if (paidFee !== toFen(order.amount as number)) {
        patch.feeMismatch = true
        alert('money', 'payCallback', 'FEE_MISMATCH', { id, paidFee, expectFen: toFen(order.amount as number) })
      }
      return patch
    }

    // 正常路径：pending → paid（库存自下单一直持有）
    const p = await transition(COLLECTIONS.orders, id, ['pending'], 'paid', payPatch)
    if (p.moved) return
    if (!p.doc) return void (await notifyAlert('money', 'payCallback', 'UNKNOWN_ORDER', { id })) // 收钱无单

    // 关单复活漏窗（P1·根因#1 修复）：p.doc 是条件更新**前**的读。若读到的仍是 'pending' 但 moved=false，
    // 说明读后被并发推进（关单定时器抢先转 closed）——不能拿「读时值」当「现在值」，须重读一次现值再分发。
    let status = String(p.doc.status || '')
    if (status === 'pending') {
      const fresh = await getDb().collection(COLLECTIONS.orders).doc(id).get().catch(() => null)
      if (!fresh || !fresh.data) return void (await notifyAlert('money', 'payCallback', 'REREAD_FAIL', { id }))
      status = String(fresh.data.status || '')
    }
    if (status === 'paid' || status === 'shipped' || status === 'done') return // 幂等 no-op
    if (status === 'refund_required') return // 幂等 no-op：另一路并发回调已处理并已告警，不重复告警
    if (status !== 'closed') return void (await notifyAlert('money', 'payCallback', 'UNEXPECTED_STATUS', { id, status }))

    // 关单后晚到的成功回调：库存已回补，须重抢回 reserved 才可复活（带竞态缓冲）。reserved 字段不受
    // 「关单」这次状态转移影响（closeExpiredOrders 只 patch status/closedAt），沿用 p.doc（条件更新前
    // 的读）里的 reserved 值仍是现值，无需为它单独再读一次。
    const reserved = Array.isArray(p.doc.reserved) ? p.doc.reserved : []
    const re = await reserveWithRetry(() => reserveStock(reserved))
    if (re.ok) {
      const c = await transition(COLLECTIONS.orders, id, ['closed'], 'paid', (order) => ({
        ...payPatch(order),
        revivedAt: Date.now(),
      }))
      if (!c.moved) await restoreStock(re.reserved) // 并发已被别的回调复活：把刚抢的还回去防双扣
    } else {
      // 库存已被买走·无法履约：钱已收 → refund_required（不超卖不吞钱），告警人工退款
      const rr = await transition(COLLECTIONS.orders, id, ['closed'], 'refund_required', {
        feeReceivedAt: Date.now(),
        transactionId,
        paidFee,
      })
      if (rr.moved) await notifyAlert('money', 'payCallback', 'PAID_BUT_OOS', { id, transactionId, paidFee })
    }
  },
})

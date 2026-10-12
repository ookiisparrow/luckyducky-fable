import { toFen, COLLECTIONS } from '@ldrw/shared'
import type { OrderDoc } from '@ldrw/shared'
import {
  defineNotifyCallback,
  transition,
  notifyAlert,
  reserveStock,
  restoreStock,
  getDb,
  isDocMissing,
  isEmptyDoc,
} from '../../kit'

// 支付结果回调。防伪/ACK/id 提取由 defineNotifyCallback 强制。
// pending→paid 直接翻单（库存自下单持有）；closed→paid 复活前必须重抢库存——抢不到进 refund_required
// （钱已收无法履约·告警人工退款·绝不超卖）。入参兼容 v3 resource 与旧 v2 字段。
// 回调点位绑定控制台工作流 paynotify。
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

// 回调里的收款字段（v3 amount.* 与旧 v2 字段兼容）。金额单位都是分。
// 核对用订单总额 total（微信原单金额）：payer_total 是扣掉微信/银行立减后的用户实付，
// 拿它核对会把用了优惠的正常单判成少付；它只存 payerTotal 备查。
// paidFee 保留 NaN：它要参与核对（NaN 必判不符）；落库前各分支自己归一。payerTotal 不参与核对，
// 在源头把非数归成 null，免得 paid / refund_required 各分支把 NaN 写进库。
function paidFieldsOf(e: any) {
  const paidFee = e.amount && e.amount.total != null ? Number(e.amount.total) : Number(e.totalFee)
  const payerTotal = e.amount && e.amount.payer_total != null ? Number(e.amount.payer_total) : null
  const transactionId = String(e.transaction_id || e.transactionId || '')
  return { paidFee, payerTotal: Number.isFinite(payerTotal) ? payerTotal : null, transactionId }
}

export const main = defineNotifyCallback<any>({
  ack: ACK,
  refId: (e) => String(e.out_trade_no || e.outTradeNo || ''),
  onNotify: async ({ id, event: e }) => {
    const success = e.trade_state === 'SUCCESS' || (e.returnCode === 'SUCCESS' && e.resultCode === 'SUCCESS')
    if (!success) return // 未成功：留 pending（等重付或超时关单）
    const { paidFee, payerTotal, transactionId } = paidFieldsOf(e)
    // 读失败≠无此单（病根#14）：只有真缺档才告警 ACK；其余读失败告警后抛——不 ACK，微信重推时幂等重跑自愈。
    // 当无单 ACK 掉，已付款单会留在 pending、被关单定时器关掉。
    const readFail = async (code: string, cause?: unknown) => {
      await notifyAlert('money', 'payCallback', code, { id })
      throw cause || new Error('PAYCB_' + code)
    }
    const initial = await getDb()
      .collection(COLLECTIONS.orders)
      .doc(id)
      .get()
      .catch((err: unknown) => (isDocMissing(err) ? null : readFail('ORDER_READ_FAIL', err)))
    if (isEmptyDoc(initial)) return void (await notifyAlert('money', 'payCallback', 'UNKNOWN_ORDER', { id }))
    const order: OrderDoc = initial.data
    const expectedFee = toFen(order.amount)
    const mismatch = paidFee !== expectedFee
    const mismatchDirection = paidFee < expectedFee ? 'underpaid' : paidFee > expectedFee ? 'overpaid' : 'unknown'
    // amount 只在建单时写入，initial 算出的应付额就是流转时的应付额：目标态与 patch 同源
    const payPatch = (): Record<string, unknown> => ({
      paidAt: Date.now(),
      transactionId,
      payerTotal,
      ...(mismatch
        ? { feeMismatch: true, expectedFee, paidFee: Number.isFinite(paidFee) ? paidFee : null, paymentMismatchDirection: mismatchDirection }
        : {}),
    })

    // 正常路径：pending → paid；金额不符进入 payment_exception（库存自下单持有，异常单不得履约）。
    // transition 内部重读或条件写失败会抛：同样先告警再抛（不 ACK，靠微信重推幂等重跑）
    const p = await transition<OrderDoc>(COLLECTIONS.orders, id, ['pending'], mismatch ? 'payment_exception' : 'paid', payPatch).catch(
      (err: unknown) => readFail('REREAD_FAIL', err)
    )
    if (p.moved) {
      if (mismatch) {
        if (Array.isArray(p.doc && p.doc.reserved) && p.doc.reserved.length) await restoreStock(p.doc.reserved)
        await notifyAlert('money', 'payCallback', 'FEE_MISMATCH', { id, paidFee, expectFen: expectedFee, direction: mismatchDirection })
      }
      return
    }
    if (!p.doc) return readFail('REREAD_FAIL') // 上面已读到单：这里没 doc＝读后被删，不 ACK 留给重推

    // 关单复活漏窗（根因#1）：p.doc 是条件更新**前**的读。若读到的仍是 'pending' 但 moved=false，
    // 说明读后被并发推进（关单定时器抢先转 closed）——不能拿「读时值」当「现在值」，须重读一次现值再分发。
    let status = String(p.doc.status || '')
    if (status === 'pending') {
      const fresh = await getDb().collection(COLLECTIONS.orders).doc(id).get().catch(() => null)
      if (!fresh || !fresh.data) return readFail('REREAD_FAIL')
      status = String(fresh.data.status || '')
    }
    if (status === 'paid' || status === 'shipped' || status === 'done') return // 幂等 no-op
    if (status === 'refund_required' || status === 'payment_exception') return // 幂等 no-op：已处理，不重复告警
    if (status !== 'closed') return void (await notifyAlert('money', 'payCallback', 'UNEXPECTED_STATUS', { id, status }))

    // 关单后晚到但金额不符：不重抢库存，直接进入异常态，避免先占货再把异常单冻结。
    if (mismatch) {
      const ex = await transition(COLLECTIONS.orders, id, ['closed'], 'payment_exception', () => ({
        ...payPatch(),
        feeReceivedAt: Date.now(),
      }))
      if (ex.moved) await notifyAlert('money', 'payCallback', 'FEE_MISMATCH', { id, paidFee, expectFen: expectedFee, direction: mismatchDirection })
      return
    }

    // 关单后晚到的成功回调：库存已回补，须重抢回 reserved 才可复活（带竞态缓冲）。reserved 字段不受
    // 「关单」这次状态转移影响（closeExpiredOrders 只 patch status/closedAt），沿用 p.doc（条件更新前
    // 的读）里的 reserved 值仍是现值，无需为它单独再读一次。
    const reserved = Array.isArray(p.doc.reserved) ? p.doc.reserved : []
    const re = await reserveWithRetry(() => reserveStock(reserved))
    if (re.ok) {
      // 复活抛错（读或写失败）：先还刚抢的库存再抛、不 ACK——不还的话每轮重推都再抢一份，永久少记。
      // 只有回读看到单已是 paid（写其实落地、只是回包丢了）才不还：那份库存正被这单占着，还了就超卖。
      // reserved 换成这次真抢到的：期间改成不限量的 SKU 这次没扣，留着旧值会让退款按旧值多还库存。
      const c = await transition(COLLECTIONS.orders, id, ['closed'], 'paid', () => ({
        ...payPatch(),
        reserved: re.reserved,
        revivedAt: Date.now(),
      })).catch(async (err: unknown) => {
        const now: OrderDoc | null = await getDb().collection(COLLECTIONS.orders).doc(id).get().then((g: any) => g.data, () => null)
        if (!now || now.status !== 'paid') await restoreStock(re.reserved)
        return readFail('REVIVE_FAIL', err)
      })
      if (!c.moved) await restoreStock(re.reserved) // 并发已被别的回调复活：把刚抢的还回去防双扣
    } else {
      // 库存已被买走·无法履约：钱已收 → refund_required（不超卖不吞钱），告警人工退款
      // paidAt＝收款时刻：对账按它归日，缺了这单会被报成「微信有我方无」
      const rr = await transition(COLLECTIONS.orders, id, ['closed'], 'refund_required', {
        paidAt: Date.now(),
        feeReceivedAt: Date.now(),
        transactionId,
        paidFee,
        payerTotal,
      })
      if (rr.moved) await notifyAlert('money', 'payCallback', 'PAID_BUT_OOS', { id, transactionId, paidFee })
    }
  },
})

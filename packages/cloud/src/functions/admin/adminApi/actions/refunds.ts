import { callFlow } from '../../../../kit'
import { reply, ensure, type Ctx } from '../lib'

// —— 售后退款（链10：审核 + 触发退款工作流；金额在申请时已云端分摊算定）——
export async function listRefunds({ db }: Ctx) {
  await ensure(db, 'afterSales')
  const res = await db.collection('afterSales').orderBy('appliedAt', 'desc').limit(200).get()
  return reply(200, { ok: true, list: res.data })
}

export async function approveRefund({ db, data }: Ctx) {
  const id = String(data.id || '')
  if (!id) return reply(400, { ok: false, error: 'BAD_ARGS' })
  const got = await db.collection('afterSales').doc(id).get().catch(() => null)
  if (!got || !got.data) return reply(400, { ok: false, error: 'NO_RECORD' })
  if (got.data.status !== 'applied') return reply(400, { ok: false, error: 'BAD_STATUS:' + got.data.status })

  const cfg = await db.collection('config').doc('pay').get().catch(() => null)
  const flowId = cfg && cfg.data && cfg.data.refundFlowId
  if (!flowId) return reply(400, { ok: false, error: 'REFUND_FLOW_NOT_CONFIGURED' })
  const order = await db.collection('orders').doc(got.data.orderId).get().catch(() => null)
  if (!order || !order.data) return reply(400, { ok: false, error: 'NO_ORDER' })

  // 原子抢占（审核批次A-2）：仍是 applied 才置 approved——并发只有一个抢到，杜绝重复触发退款
  const grab = await db
    .collection('afterSales')
    .where({ _id: id, status: 'applied' })
    .update({ data: { status: 'approved', approvedAt: Date.now() } })
  if (!grab.stats || grab.stats.updated !== 1) {
    return reply(400, { ok: false, error: 'BAD_STATUS:concurrent' })
  }

  // 触发退款工作流（kit.callFlow 单点，根因#12）：金额取售后单分摊额 + 订单实付，不收前端
  const r = await callFlow(String(flowId), {
    out_trade_no: got.data.orderId,
    out_refund_no: id,
    reason: String(got.data.reason || '用户申请退款').slice(0, 80),
    amount: {
      refund: Math.round(got.data.refundAmount * 100),
      total: Math.round(order.data.amount * 100),
      currency: 'CNY',
    },
  })
  if (!r || !(r.status || r.refund_id || r.out_refund_no)) {
    console.error('approveRefund 工作流未受理', id)
    // 回滚抢占，允许人工重试（审核批次A-2）
    await db.collection('afterSales').doc(id).update({ data: { status: 'applied' } }).catch(() => {})
    return reply(500, { ok: false, error: 'REFUND_TRIGGER_FAIL' })
  }
  return reply(200, { ok: true })
}

export async function rejectRefund({ db, data }: Ctx) {
  const id = String(data.id || '')
  const reason = String(data.reason || '').trim().slice(0, 100)
  if (!id || !reason) return reply(400, { ok: false, error: 'BAD_ARGS' })
  const got = await db.collection('afterSales').doc(id).get().catch(() => null)
  if (!got || !got.data) return reply(400, { ok: false, error: 'NO_RECORD' })
  if (got.data.status !== 'applied') return reply(400, { ok: false, error: 'BAD_STATUS:' + got.data.status })
  await db
    .collection('afterSales')
    .doc(id)
    .update({ data: { status: 'rejected', rejectedAt: Date.now(), rejectReason: reason } })
  return reply(200, { ok: true })
}

import { toFen, AFTERSALE_STATUS } from '@luckyducky/shared'
import { callFlow, pageQuery } from '../../../../kit'
import { reply, ensure, activationFor, type Ctx } from '../lib'

// —— 售后退款（链10：审核 + 触发退款工作流；金额在申请时已云端分摊算定）——
// 列表游标分页（根因#7）：无参=首页 200（兼容旧控制台读 .list）。
// 服务端筛选/搜索（根因#7 计数/筛选/搜索失真·与订单同治）：status 云端 where 过滤、q=订单号精确
// 命中（orderId·一单可多条售后行），无视状态标签搜全部。计数另走 refundCounts（.count() 精确）。
export async function listRefunds({ db, data }: Ctx) {
  await ensure(db, 'afterSales')
  const q = String((data && data.q) || '').trim()
  const status = String((data && data.status) || '')
  const filter: Record<string, any> = q
    ? { orderId: q } // 搜索：订单号精确，跨全部状态
    : status && status !== 'all'
      ? { status }
      : {}
  const paged = await pageQuery(db, 'afterSales', filter, 'appliedAt', data, 200)
  return reply(200, { ok: true, ...paged })
}

// 按状态服务端精确计数（根因#7 计数失真）：每状态 + 全部走 .count()（精确·不封顶·不受分页影响），
// 状态枚举绑售后域单源 AFTERSALE_STATUS（新增状态自动覆盖·根因#2）。前端标签计数只读此结果。
export async function refundCounts({ db }: Ctx) {
  await ensure(db, 'afterSales')
  const cnt = (query: any) =>
    query
      .count()
      .then((r: any) => r.total || 0)
      .catch(() => 0)
  const statuses = Object.values(AFTERSALE_STATUS) as string[]
  const [all, ...nums] = await Promise.all([
    cnt(db.collection('afterSales')),
    ...statuses.map((s) => cnt(db.collection('afterSales').where({ status: s }))),
  ])
  const counts: Record<string, number> = { all }
  statuses.forEach((s, i) => (counts[s] = nums[i]))
  return reply(200, { ok: true, counts })
}

// 退款决策判据（激活码状态数据链·闭 S10「自动判据」洞·根因#8：不伪造徽章→补真数据）。读类·不写库。
// 按 afterSale._openid + 该商品对应课程（products.courseId·回退 course-<productId>·与 genQrcodes/StepBatch
// 同口径），查 activations 算「买家是否已激活/已进课该课程」——给审核员真判据（已激活=退货权失·谨慎）。
export async function getRefundDetail({ db, data }: Ctx) {
  const id = String((data && data.id) || '')
  if (!id) return reply(400, { ok: false, error: 'BAD_ARGS' })
  const got = await db.collection('afterSales').doc(id).get().catch(() => null)
  if (!got || !got.data) return reply(400, { ok: false, error: 'NO_RECORD' })
  const a = got.data
  return reply(200, { ok: true, activation: await activationFor(db, a._openid, a.productId) })
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

  // 复核进课退货权（外审 R1-R4·P1.2·根因#1 副作用绑状态机）：用户先申请退款（applied）后再确认进课时，
  // confirmEnter 会把该订单行 refundable 翻 false（退货权失效·链6）。同意退款前必须复核此刻该订单行是否仍可退——
  // 否则形成「已交付课程 + 已退款」。按有效行键定位该售后对应订单行（外审 P1.1：新售后有 lineId 精确、旧售后回退
  // productId），已撤退货权即拒、不触发退款工作流。
  const reqLine = got.data.lineId || got.data.productId
  const line = (order.data.items || []).find((it: any) => (it.lineId || it.productId) === reqLine)
  if (line && line.refundable === false) {
    return reply(400, { ok: false, error: 'ENTERED_NOT_REFUNDABLE' })
  }

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
      refund: toFen(got.data.refundAmount),
      total: toFen(order.data.amount),
      currency: 'CNY',
    },
  })
  if (!r || !(r.status || r.refund_id || r.out_refund_no)) {
    console.error('approveRefund 工作流未受理', id)
    // 条件回滚（审计 P1·防二次退款）：仅当仍是 approved 才退回 applied。callFlow 超时返 null 时微信可能已真退款，
    // 退款回调会抢先 approved→refunded；无条件 .doc().update 会把 refunded 打回 applied→可二次审批重复退款。
    // where(status:approved) 保证只回滚未被回调推进的那一笔。
    await db
      .collection('afterSales')
      .where({ _id: id, status: 'approved' })
      .update({ data: { status: 'applied' } })
      .catch(() => {})
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

import { toFen, asFen, fenToYuan, refundShareFen, AFTERSALE_STATUS } from '@ldrw/shared'
import { callFlow, pageQuery } from '../../../kit'
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

  // 复核进课退货权（外审 R1-R4·P1.2 + 深审① 2026-07-02·根因#1 副作用绑状态机）：用户先申请退款（applied）
  // 后再确认进课时，confirmEnter 按件递增 enteredQty（全进才翻 refundable=false）。同意退款前必须按**此刻**
  // 的订单行复核：① 全进课（refundable=false 或剩余可退 0 件）→ 拒，防「已交付课程 + 已退款」；② 部分又进课
  // （剩余可退 < 申请时件数）→ **按当下重算封顶**（用户拍板）：售后单件数/金额同步降级后再打款——只退真正
  // 剩余的钱，不再按申请时刻的件数多退。按有效行键定位（外审 P1.1：新售后 lineId 精确、旧售后回退 productId）。
  const reqLine = got.data.lineId || got.data.productId
  const line = (order.data.items || []).find((it: any) => (it.lineId || it.productId) === reqLine)
  let requalify: Record<string, unknown> | null = null
  if (line) {
    const lineQty = line.qty || 1
    const refundableQtyNow = lineQty - (line.enteredQty || 0)
    if (line.refundable === false || refundableQtyNow <= 0) {
      return reply(400, { ok: false, error: 'ENTERED_NOT_REFUNDABLE' })
    }
    const recQty = Number(got.data.qty) || refundableQtyNow // 旧售后单无 qty：视作当下值（不降级）
    if (refundableQtyNow < recQty) {
      // 申请后又进课：按当下剩余件数重算分摊（公式单源 shared refundShareFen·与 applyRefund 同一份）
      const amountFen = toFen(Number(order.data.amount))
      const goodsFen = toFen(Number(order.data.goods))
      const itemFen = asFen(toFen(line.price) * refundableQtyNow)
      const exist = await db.collection('afterSales').where({ orderId: got.data.orderId }).get().catch(() => ({ data: [] }))
      const used = asFen(
        exist.data
          .filter((a: any) => a._id !== id && ['applied', 'approved', 'refunded'].includes(a.status))
          .reduce((s: number, a: any) => s + toFen(Number(a.refundAmount)), 0)
      )
      const refundFen = refundShareFen(amountFen, goodsFen, itemFen, used)
      if (refundFen <= 0) return reply(400, { ok: false, error: 'NOTHING_LEFT' })
      requalify = {
        qty: refundableQtyNow,
        itemTotal: fenToYuan(itemFen),
        refundAmount: fenToYuan(refundFen),
        requalifiedAt: Date.now(), // 留痕：这单在审批时按当下降过级（对账/客诉可溯）
      }
    }
  }

  // 原子抢占（审核批次A-2）：仍是 applied 才置 approved——并发只有一个抢到，杜绝重复触发退款；
  // 重算降级（requalify）与抢占同一次条件更新落库：打款金额与售后单永远一致（refundCallback 金额核验依赖它）。
  const grab = await db
    .collection('afterSales')
    .where({ _id: id, status: 'applied' })
    .update({ data: { status: 'approved', approvedAt: Date.now(), ...(requalify || {}) } })
  if (!grab.stats || grab.stats.updated !== 1) {
    return reply(400, { ok: false, error: 'BAD_STATUS:concurrent' })
  }

  // 触发退款工作流（kit.callFlow 单点，根因#12）：金额取售后单分摊额（重算降级后以新额为准）+ 订单实付，不收前端
  const refundYuan = requalify ? (requalify.refundAmount as number) : Number(got.data.refundAmount)
  const r = await callFlow(String(flowId), {
    out_trade_no: got.data.orderId,
    out_refund_no: id,
    reason: String(got.data.reason || '用户申请退款').slice(0, 80),
    amount: {
      refund: toFen(refundYuan),
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
  // 条件更新（深审②·原子化）：仍是 applied 才置 rejected——读检查到写入之间被同意抢先（approved·钱已进
  // 退款通道）时绝不 clobber 回 rejected（否则退款回调 from applied/approved 抢不到状态·钱退了单据却是已拒绝）。
  const grab = await db
    .collection('afterSales')
    .where({ _id: id, status: 'applied' })
    .update({ data: { status: 'rejected', rejectedAt: Date.now(), rejectReason: reason } })
  if (!grab.stats || grab.stats.updated !== 1) {
    return reply(400, { ok: false, error: 'BAD_STATUS:concurrent' })
  }
  return reply(200, { ok: true })
}

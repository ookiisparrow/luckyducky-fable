import { ORDER_STATUS } from '@luckyducky/shared'
import { pageQuery, uploadShippingToWx, notifyAlert } from '../../../../kit'
import { reply, type Ctx } from '../lib'

// —— 订单发货（状态流转 paid → shipped；金额/条目/地址只读不动）——
// 列表游标分页（根因#7）：无参=首页 200（兼容旧控制台读 .list），控制台用 nextCursor 翻页。
// 服务端筛选/搜索（根因#7 计数/筛选/搜索失真）：status 在云端 where 过滤（不让前端从已加载页筛、
// 防分页后漏单）；q=单号精确命中（_id），无视状态标签搜全部。计数另走 orderCounts（.count() 精确）。
export async function listOrders({ db, data }: Ctx) {
  const q = String((data && data.q) || '').trim()
  const status = String((data && data.status) || '')
  const filter: Record<string, any> = q
    ? { _id: q } // 搜索：单号精确，跨全部状态
    : status && status !== 'all'
      ? { status }
      : {}
  const paged = await pageQuery(db, 'orders', filter, 'createdAt', data, 200)
  return reply(200, { ok: true, ...paged })
}

// 按状态服务端精确计数（根因#7 计数失真）：每状态 + 全部走 .count()（精确·不封顶·不受分页影响），
// 状态枚举绑订单域单源 ORDER_STATUS（新增状态自动覆盖·根因#2）。前端标签计数只读此结果、不数已加载页。
export async function orderCounts({ db }: Ctx) {
  const cnt = (query: any) =>
    query
      .count()
      .then((r: any) => r.total || 0)
      .catch(() => 0)
  const statuses = Object.values(ORDER_STATUS) as string[]
  const [all, ...nums] = await Promise.all([
    cnt(db.collection('orders')),
    ...statuses.map((s) => cnt(db.collection('orders').where({ status: s }))),
  ])
  const counts: Record<string, number> = { all }
  statuses.forEach((s, i) => (counts[s] = nums[i]))
  return reply(200, { ok: true, counts })
}

export async function shipOrder({ db, data }: Ctx) {
  const id = String(data.id || '')
  const company = String(data.company || '').trim().slice(0, 30)
  const trackingNo = String(data.trackingNo || '').trim().slice(0, 40)
  if (!id || !company || !trackingNo) return reply(400, { ok: false, error: 'BAD_ARGS' })
  const got = await db.collection('orders').doc(id).get().catch(() => null)
  if (!got || !got.data) return reply(400, { ok: false, error: 'NO_ORDER' })
  const cur = got.data.status
  // paid = 首次发货；shipped = 改单号。其余状态不允许动。
  if (cur !== 'paid' && cur !== 'shipped') return reply(400, { ok: false, error: 'BAD_STATUS:' + cur })
  // 金额异常单（feeMismatch 留痕）须先「解除」后才能发货（审核批次A 折中）
  if (got.data.feeMismatch) return reply(400, { ok: false, error: 'FEE_MISMATCH_HOLD' })
  // 条件更新（审核批次A-6）：仍是 paid/shipped 才写——防与确认收货并发把 done 回滚
  const upd = await db
    .collection('orders')
    .where({ _id: id, status: db.command.in(['paid', 'shipped']) })
    .update({
      data: { status: 'shipped', shipping: { company, trackingNo }, shippedAt: got.data.shippedAt || Date.now() },
    })
  if (!upd.stats || upd.stats.updated !== 1) {
    const fresh = await db.collection('orders').doc(id).get().catch(() => null)
    return reply(400, { ok: false, error: 'BAD_STATUS:' + ((fresh && fresh.data && fresh.data.status) || 'unknown') })
  }
  // 合规债#26（根因#12）：本地发货成功后向微信上传发货信息——实物+微信支付不上传则订单资金冻结/无法结算。
  // fail-soft：上传失败绝不回滚本地发货（已 shipped），只留痕 + [LD_ALERT] sev=money 告警，靠人去 mp 后台手动录入兜底。
  const ship = await uploadShippingToWx({
    orderId: id,
    openid: String(got.data._openid || ''),
    transactionId: String(got.data.transactionId || ''),
    company,
    trackingNo,
  })
  await db
    .collection('orders')
    .doc(id)
    .update({
      data: ship.ok
        ? { wxShipUploaded: true, wxShipError: '', wxShipAt: Date.now() }
        : { wxShipUploaded: false, wxShipError: ship.error || 'WX_SHIP_FAIL' },
    })
    .catch(() => null)
  if (!ship.ok) await notifyAlert('money', 'shipOrder', 'WX_SHIP_UPLOAD_FAIL', { orderId: id, error: ship.error })
  return reply(200, { ok: true, wxShip: ship.ok })
}

// 金额异常单人工复核解除（feeMismatch 单禁发货，核实流水后在此解除）
export async function clearFeeMismatch({ db, data }: Ctx) {
  const id = String(data.id || '')
  if (!id) return reply(400, { ok: false, error: 'BAD_ARGS' })
  const got = await db.collection('orders').doc(id).get().catch(() => null)
  if (!got || !got.data) return reply(400, { ok: false, error: 'NO_ORDER' })
  await db.collection('orders').doc(id).update({ data: { feeMismatch: false, feeMismatchClearedAt: Date.now() } })
  return reply(200, { ok: true })
}

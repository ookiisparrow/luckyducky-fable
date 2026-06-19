import { pageQuery, uploadShippingToWx, alert } from '../../../../kit'
import { reply, type Ctx } from '../lib'

// —— 订单发货（状态流转 paid → shipped；金额/条目/地址只读不动）——
// 列表游标分页（根因#7）：无参=首页 200（兼容旧控制台读 .list），控制台用 nextCursor 翻页。
export async function listOrders({ db, data }: Ctx) {
  const paged = await pageQuery(db, 'orders', {}, 'createdAt', data, 200)
  return reply(200, { ok: true, ...paged })
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
  if (!ship.ok) alert('money', 'shipOrder', 'WX_SHIP_UPLOAD_FAIL', { orderId: id, error: ship.error })
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

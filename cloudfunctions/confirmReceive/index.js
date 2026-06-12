// 确认收货（敏感业务：订单状态流转一律走云函数，前端禁写 orders）。
// openid 闸门：取自 getWXContext，只能确认自己的订单；仅 shipped → done，
// 其余状态拒绝（防重复确认 / 防越过发货直接完成）。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return { ok: false, error: 'NO_OPENID' }
  const id = String(event.id || '')
  if (!id) return { ok: false, error: 'NO_ID' }

  const got = await db.collection('orders').doc(id).get().catch(() => null)
  if (!got || !got.data || got.data._openid !== OPENID) return { ok: false, error: 'NOT_FOUND' }
  if (got.data.status !== 'shipped') return { ok: false, error: 'BAD_STATUS:' + got.data.status }

  // 条件更新（审核批次A-6）：只在「仍是 shipped」时翻 done——防与后台改单号等并发交错
  // 造成状态回滚（先查后写不是原子的，上面的检查只为给出准确错误码）。
  const doneAt = Date.now()
  const upd = await db
    .collection('orders')
    .where({ _id: id, status: 'shipped' })
    .update({ data: { status: 'done', doneAt } })
  if (!upd.stats || upd.stats.updated !== 1) {
    const fresh = await db.collection('orders').doc(id).get().catch(() => null)
    return { ok: false, error: 'BAD_STATUS:' + ((fresh && fresh.data && fresh.data.status) || 'unknown') }
  }
  return { ok: true, doneAt }
}

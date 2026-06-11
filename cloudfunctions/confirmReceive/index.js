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

  const doneAt = Date.now()
  await db.collection('orders').doc(id).update({ data: { status: 'done', doneAt } })
  return { ok: true, doneAt }
}

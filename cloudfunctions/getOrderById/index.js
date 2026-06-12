// 按单号取本人订单（审核批次B：getMyOrders 固定 limit，老订单不在列表缓存时
// 详情页会误报「没有找到」——本函数做详情兜底，openid 闸门保证只能查自己的单）。
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
  return { ok: true, order: got.data }
}

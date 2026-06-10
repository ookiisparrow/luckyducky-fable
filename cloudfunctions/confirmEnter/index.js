// 确认开始观看（规格 §四-3，2026-06-10 修订版）：退货权法律节点。
// ① 写 activation.enteredAt（时间戳留证，只写一次）；
// ② 启发式自动失效：确认者本人订单中含该课程对应商品（products.courseId 反查）
//    的可退条目，取最早一条 refundable=false。送礼场景（确认者无订单）不命中，
//    由「退货验收扫码」兜底（裁决以验收扫码为准，refundable 是展示性标记）。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return { ok: false, error: 'NO_OPENID' }
  const code = String(event.code || '').trim()
  if (!code) return { ok: false, error: 'BAD_ARGS' }

  const acts = await db.collection('activations').where({ code, _openid: OPENID }).get()
  if (!acts.data.length) return { ok: false, error: 'NOT_ACTIVATED' }
  const act = acts.data[0]

  const now = Date.now()
  let enteredAt = act.enteredAt
  if (!enteredAt) {
    enteredAt = now
    await db.collection('activations').doc(act._id).update({ data: { enteredAt: now } })
  }

  // 启发式失效：该课程对应的商品 → 本人订单里最早一条可退条目
  let revoked = null
  const prods = await db.collection('products').where({ courseId: act.courseId }).get()
  const prodIds = prods.data.map((p) => p.id)
  if (prodIds.length) {
    const orders = await db
      .collection('orders')
      .where({ _openid: OPENID, status: 'paid' })
      .orderBy('createdAt', 'asc')
      .get()
    for (const order of orders.data) {
      const idx = (order.items || []).findIndex((it) => prodIds.includes(it.productId) && it.refundable)
      if (idx >= 0) {
        const items = order.items.map((it, i) => (i === idx ? { ...it, refundable: false } : it))
        await db.collection('orders').doc(order._id).update({ data: { items } })
        revoked = { orderId: order.id, productId: order.items[idx].productId }
        break
      }
    }
  }

  return { ok: true, enteredAt, revoked }
}

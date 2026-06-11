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
  let revoked = null

  // 退货权失效与「首次进课」原子绑定：只在第一次确认那一刻执行一次。
  // 调试日志 I：原本失效块在守卫外、每次调用都跑 → 重复确认会多扣下一笔订单（不幂等）。
  if (!enteredAt) {
    enteredAt = now
    await db.collection('activations').doc(act._id).update({ data: { enteredAt: now } })

    // 启发式失效：该课程对应的商品 → 本人订单里最早一条可退条目翻 false。
    // 调试日志 H：订单状态放宽到 paid/shipped/done——真实流程顾客是收货后才扫码确认，
    // 此时订单早已不是 paid，原 status:'paid' 过滤会扫不到 → 失效静默不执行。
    const prods = await db.collection('products').where({ courseId: act.courseId }).get()
    const prodIds = prods.data.map((p) => p.id)
    if (prodIds.length) {
      const orders = await db
        .collection('orders')
        .where({ _openid: OPENID, status: _.in(['paid', 'shipped', 'done']) })
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
  }

  return { ok: true, enteredAt, revoked }
}

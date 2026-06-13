import { withOpenId, ok, err } from '../../kit'

// 确认开始观看（规格 §四-3）：退货权法律节点。
// ① 写 activation.enteredAt（只一次）；② 启发式自动失效：本人订单含该课程对应商品的可退条目，
// 取最早一条翻 refundable=false。送礼场景（无订单）不命中，由退货验收扫码兜底。
//
// 退货权失效与「首次进课」原子绑定（根因账本 #1，调试日志 H/I + 审核批次A-6）：
// where({_id, enteredAt:null}).update 抢占，只有抢占成功者执行失效——并发/重复确认不多扣。
export const main = withOpenId(async ({ db, OPENID, event }) => {
  const _ = db.command
  const code = String(event.code || '').trim()
  if (!code) return err('BAD_ARGS')

  const acts = await db.collection('activations').where({ code, _openid: OPENID }).get()
  if (!acts.data.length) return err('NOT_ACTIVATED')
  const act = acts.data[0]

  const now = Date.now()
  let enteredAt = act.enteredAt
  let revoked: { orderId: string; productId: string } | null = null

  if (!enteredAt) {
    const grab = await db
      .collection('activations')
      .where({ _id: act._id, enteredAt: null })
      .update({ data: { enteredAt: now } })
    if (!grab.stats || grab.stats.updated !== 1) {
      // 并发输家：读回真正的首次确认时间，不执行失效
      const fresh = await db.collection('activations').doc(act._id).get().catch(() => null)
      return ok({ enteredAt: (fresh && fresh.data && fresh.data.enteredAt) || now, revoked: null })
    }
    enteredAt = now

    // 启发式失效：状态放宽 paid/shipped/done（H：真实流程收货后才扫码确认）
    const prods = await db.collection('products').where({ courseId: act.courseId }).get()
    const prodIds = prods.data.map((p: any) => p.id)
    if (prodIds.length) {
      const orders = await db
        .collection('orders')
        .where({ _openid: OPENID, status: _.in(['paid', 'shipped', 'done']) })
        .orderBy('createdAt', 'asc')
        .get()
      for (const order of orders.data) {
        const idx = (order.items || []).findIndex(
          (it: any) => prodIds.includes(it.productId) && it.refundable
        )
        if (idx >= 0) {
          const items = order.items.map((it: any, i: number) =>
            i === idx ? { ...it, refundable: false } : it
          )
          await db.collection('orders').doc(order._id).update({ data: { items } })
          revoked = { orderId: order.id, productId: order.items[idx].productId }
          break
        }
      }
    }
  }

  return ok({ enteredAt, revoked })
})

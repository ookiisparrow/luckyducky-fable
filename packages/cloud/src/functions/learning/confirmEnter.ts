import { withOpenId, ok, err, alert } from '../../kit'

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
  let revoked: { orderId: string; lineId: string; productId: string } | null = null

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
        .limit(200) // 显式上界（规模·根因#7）：防裸 .get() 默认 100 截断漏到要撤退货权的订单（>100 单可白退）
        .get()
      for (const order of orders.data) {
        // items 写入过 entVer 版本位 CAS（深审⑤·根因#1）：整数组读-改-写无条件落库会与并发进课互覆盖
        // 少记件数（剩余可退虚高＝可多退一件的钱）——条件更新仅当 entVer 未被并发推进才写，冲突重读重试。
        let cur: any = order
        for (let attempt = 0; attempt < 3 && cur; attempt++) {
          // 找一条仍有可退件的本课程行（refundable 未失 + 已进课件数 < 购买件数·外审 P1.3）
          const idx = (cur.items || []).findIndex(
            (it: any) =>
              prodIds.includes(it.productId) && it.refundable !== false && (it.enteredQty || 0) < (it.qty || 1)
          )
          if (idx < 0) break // 此单已无可进账行（可能被并发进满）→ 看下一单
          const items = cur.items.map((it: any, i: number) => {
            if (i !== idx) return it
            // 进课撤一件退货权（外审 P1.3·根因#1 数量级权益）：enteredQty++ 而非整行作废；全部进课才整行不可退。
            // 旧订单无 enteredQty 视 0：qty=1 行进一次即 refundable=false（与原整行翻 false 等效·兼容）。
            const entered = (it.enteredQty || 0) + 1
            const qty = it.qty || 1
            return { ...it, enteredQty: entered, refundable: entered < qty }
          })
          // 旧单无 entVer：exists(false) 前置条件（同 throttle CAS 范式）；首写 → 1
          const upd = await db
            .collection('orders')
            .where({ _id: cur._id, entVer: typeof cur.entVer === 'number' ? cur.entVer : _.exists(false) })
            .update({ data: { items, entVer: (cur.entVer || 0) + 1 } })
          if (upd.stats && upd.stats.updated === 1) {
            const ri = cur.items[idx]
            // revoked 带有效行键（外审 P1.1）：标识撤退货权的具体订单行（新单 lineId / 旧单 productId）
            revoked = { orderId: cur.id, lineId: ri.lineId || ri.productId, productId: ri.productId }
            break
          }
          // 冲突：并发进课抢先推进 entVer → 重读本单再试（重试耗尽极罕见·告警人工，不静默丢退货权撤账）
          const fresh = await db.collection('orders').doc(cur._id).get().catch(() => null)
          cur = fresh && fresh.data
          if (attempt === 2) alert('money', 'confirmEnter', 'REVOKE_RACE', { orderId: order.id })
        }
        if (revoked) break
      }
    }
  }

  return ok({ enteredAt, revoked })
})

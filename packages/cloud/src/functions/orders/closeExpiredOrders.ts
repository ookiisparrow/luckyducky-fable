import { getDb, ok, isServerCall, restoreStock } from '../../kit'
import { PAY_WINDOW_MS } from '@luckyducky/shared'

// 超时关单（定时触发器，每 5 分钟，见 cloudbaserc triggers）：pending 超 PAY_WINDOW_MS（15 分钟）→ closed
//（与 pay 惰性关单同口径，窗口走 shared 单源·病根#5）。关单后回调若到达 payCallback 会复活成 paid。
// 库存#1：关单须**回补预留库存**——故从批量 update 改按单循环，抢占 pending→closed 那次才回补
// （绑状态转移·幂等防重复回补：已 closed 不在查询内）。bounded ≤200/次（每 5 分钟跑·capacity-reads-bounded）。
// 非原子说明（审计 P2）：「转 closed」与「回补」跨 orders/inventory 两集合、无法单事务原子（先 closed 后回补·
// 此序错向安全：宁可 payCallback 误判售罄[可退款]·不冒先回补被并发买走的超卖）。那一瞬「已 closed 未回补」
// 被晚到回调撞上由 payCallback 的 reserveWithRetry 竞态缓冲吸收（重试待回补落定·真售罄才 refund_required）。

export const main = async () => {
  // 仅定时器/服务端触发（无 openid）；客户端带身份调用一律拒（根因#3：写库必过闸，防滥调）
  if (!isServerCall()) return ok({ closed: 0 })
  const db = getDb()
  const _ = db.command
  const cutoff = Date.now() - PAY_WINDOW_MS
  const expired = await db
    .collection('orders')
    .where({ status: 'pending', createdAt: _.lt(cutoff) })
    .limit(200)
    .get()
    .catch(() => ({ data: [] }))
  let closed = 0
  for (const o of expired.data || []) {
    const r = await db
      .collection('orders')
      .where({ _id: o._id, status: 'pending' })
      .update({ data: { status: 'closed', closedAt: Date.now() } })
      .catch(() => ({ stats: { updated: 0 } }))
    if (r.stats && r.stats.updated === 1) {
      closed++
      if (Array.isArray(o.reserved) && o.reserved.length) await restoreStock(o.reserved)
    }
  }
  return ok({ closed })
}

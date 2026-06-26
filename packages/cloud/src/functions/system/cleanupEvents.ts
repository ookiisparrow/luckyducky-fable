import { getDb, ok, isServerCall } from '../../kit'

// 清理无界增长集合（待办债#9 + 外审 P2.14）。定时触发器（每日）。三类只增不删/会堆积的数据保留 90 天：
//  ① events 原始埋点流（只写不读·看板读 progress 折叠视图·删旧不损功能）；
//  ② rateLimit 频控窗口（窗 60s·锁 ≤30min·90 天前的 key 早已无锁/无窗·删了下次命中重建）；
//  ③ kfState 的 seen:<msgid> 客服去重痕（带 at 字段；cursor:*/token 文档无 at·不误删）。
// 仅服务端/定时触发（无 openid）；客户端带身份调用一律拒（根因#3：写库必过闸，防滥调）。
const RETAIN_MS = 90 * 24 * 3600 * 1000 // 保留 90 天

export const main = async () => {
  if (!isServerCall()) return ok({ removed: 0 })
  const db = getDb()
  const _ = db.command
  const cutoff = Date.now() - RETAIN_MS
  const n = (x: any) => (x && x.stats && x.stats.removed) || 0
  // 服务端按条件批量删（与 closeExpiredOrders 同口径，每日一轮收敛；集合不存在则 0）
  const rmEvents = await db
    .collection('events')
    .where({ createdAt: _.lt(cutoff) })
    .remove()
    .catch(() => ({ stats: { removed: 0 } }))
  // 频控窗口 TTL（外审 P2.14）：按 updatedAt（throttle 每次写更新）删·非 createdAt（创建即定·活跃 key 会被误删）
  const rmRate = await db
    .collection('rateLimit')
    .where({ updatedAt: _.lt(cutoff) })
    .remove()
    .catch(() => ({ stats: { removed: 0 } }))
  // 客服去重痕 TTL（外审 P2.14）：seen:<msgid> 带 at·按 at 删；cursor:*/token 无 at 字段故不误删
  const rmSeen = await db
    .collection('kfState')
    .where({ at: _.lt(cutoff) })
    .remove()
    .catch(() => ({ stats: { removed: 0 } }))
  return ok({ removed: n(rmEvents), rateLimit: n(rmRate), kfSeen: n(rmSeen) })
}

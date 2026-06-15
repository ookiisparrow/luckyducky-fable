import { getDb, ok, isServerCall } from '../../kit'

// 清理 events 流水（待办债#9：trackEvent 只增不删 → 存储/成本无界增长）。定时触发器（每日）。
// 安全前提：events 是只写不读的原始埋点流——看板读的是 progress 折叠视图、无人读 events（已核），
// 故删旧档不损功能。保留 90 天（含原始分析口径），更早的删除。
// 仅服务端/定时触发（无 openid）；客户端带身份调用一律拒（根因#3：写库必过闸，防滥调）。
const RETAIN_MS = 90 * 24 * 3600 * 1000 // 保留 90 天

export const main = async () => {
  if (!isServerCall()) return ok({ removed: 0 })
  const db = getDb()
  const _ = db.command
  const cutoff = Date.now() - RETAIN_MS
  // 服务端按条件批量删（与 closeExpiredOrders 同口径，每日一轮收敛；events 集合不存在则 0）
  const r = await db
    .collection('events')
    .where({ createdAt: _.lt(cutoff) })
    .remove()
    .catch(() => ({ stats: { removed: 0 } }))
  return ok({ removed: (r.stats && r.stats.removed) || 0 })
}

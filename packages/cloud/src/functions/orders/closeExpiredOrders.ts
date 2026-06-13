import { getDb, ok, isServerCall } from '../../kit'

// 超时关单（定时触发器，每 5 分钟，见 cloudbaserc triggers）：pending 超 15 分钟 → closed
//（与 pay 惰性关单同口径）。关单后回调若到达 payCallback 会复活成 paid。
const EXPIRE_MS = 15 * 60 * 1000

export const main = async () => {
  // 仅定时器/服务端触发（无 openid）；客户端带身份调用一律拒（根因#3：写库必过闸，防滥调）
  if (!isServerCall()) return ok({ closed: 0 })
  const db = getDb()
  const _ = db.command
  const cutoff = Date.now() - EXPIRE_MS
  const res = await db
    .collection('orders')
    .where({ status: 'pending', createdAt: _.lt(cutoff) })
    .update({ data: { status: 'closed', closedAt: Date.now() } })
  return ok({ closed: (res.stats && res.stats.updated) || 0 })
}

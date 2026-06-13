import { getDb, ok } from '../../kit'

// 超时关单（定时触发器，每 5 分钟，见 cloudbaserc triggers）：pending 超 15 分钟 → closed
//（与 pay 惰性关单同口径）。系统触发无 openid，无身份闸。关单后回调若到达 payCallback 会复活成 paid。
const EXPIRE_MS = 15 * 60 * 1000

export const main = async () => {
  const db = getDb()
  const _ = db.command
  const cutoff = Date.now() - EXPIRE_MS
  const res = await db
    .collection('orders')
    .where({ status: 'pending', createdAt: _.lt(cutoff) })
    .update({ data: { status: 'closed', closedAt: Date.now() } })
  return ok({ closed: (res.stats && res.stats.updated) || 0 })
}

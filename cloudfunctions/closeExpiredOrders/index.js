// 超时关单（定时触发器，每 5 分钟，见 cloudbaserc.json triggers）：
// pending 超 15 分钟 → closed（与 pay 的惰性关单同口径）。
// 关单后支付回调若仍到达（用户卡点支付），payCallback 会把单复活成 paid。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const EXPIRE_MS = 15 * 60 * 1000

exports.main = async () => {
  const cutoff = Date.now() - EXPIRE_MS
  const res = await db
    .collection('orders')
    .where({ status: 'pending', createdAt: _.lt(cutoff) })
    .update({ data: { status: 'closed', closedAt: Date.now() } })
  return { ok: true, closed: (res.stats && res.stats.updated) || 0 }
}

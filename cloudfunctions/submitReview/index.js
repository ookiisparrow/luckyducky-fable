// 提交商品评价（敏感业务：前端禁写 reviews，一律走这里）。
// 闸门（见 CLAUDE.md §14 / 规格 §三）：
//   - openid 取自 getWXContext，不信任前端传入。
//   - 只能评价自己的「已完成」订单，且商品必须在该订单条目里。
//   - 一单一品一评：重复提交拒绝（REVIEWED）。
//   - 昵称从云端 users 快照（不信任前端传入）；匿名则存「匿名钩友」。
//   - 字段白名单 + 截断：rating 1–5 整数 / text ≤500 / tags ≤6 个、每个 ≤10 字。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return { ok: false, error: 'NO_OPENID' }

  const orderId = String(event.orderId || '')
  const productId = String(event.productId || '')
  const rating = Number(event.rating)
  if (!orderId || !productId) return { ok: false, error: 'BAD_ARGS' }
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { ok: false, error: 'BAD_RATING' }
  }
  const text = typeof event.text === 'string' ? event.text.trim().slice(0, 500) : ''
  const tags = (Array.isArray(event.tags) ? event.tags : [])
    .filter((t) => typeof t === 'string' && t.trim())
    .slice(0, 6)
    .map((t) => t.trim().slice(0, 10))

  // 订单归属 + 状态 + 商品在单内
  const got = await db.collection('orders').doc(orderId).get().catch(() => null)
  if (!got || !got.data || got.data._openid !== OPENID) return { ok: false, error: 'NOT_FOUND' }
  if (got.data.status !== 'done') return { ok: false, error: 'NOT_DONE' }
  const item = (got.data.items || []).find((it) => it.productId === productId)
  if (!item) return { ok: false, error: 'NOT_IN_ORDER' }

  try {
    await db.createCollection('reviews')
  } catch {
    /* 已存在 */
  }
  const reviews = db.collection('reviews')

  // 一单一品一评
  const dup = await reviews.where({ _openid: OPENID, orderId, productId }).count()
  if (dup.total > 0) return { ok: false, error: 'REVIEWED' }

  // 昵称快照：users 的 nickname；匿名或无昵称给默认
  let name = '匿名钩友'
  if (!event.anon) {
    const u = await db.collection('users').where({ _openid: OPENID }).get()
    name = (u.data[0] && u.data[0].nickname) || '鸭友'
  }

  const review = {
    _openid: OPENID,
    orderId,
    productId,
    name,
    rating,
    tags,
    text,
    spec: String(item.spec || ''),
    createdAt: Date.now(),
  }
  await reviews.add({ data: review })
  return { ok: true }
}

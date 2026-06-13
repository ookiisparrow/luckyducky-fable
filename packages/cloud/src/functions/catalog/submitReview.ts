import { withOpenId, ok, err } from '../../kit'

// 提交商品评价（敏感：前端禁写 reviews）。闸门：openid + 订单归属 + 已完成 + 商品在单内 +
// 一单一品一评（确定性 _id=orderId__productId 库级唯一，根因账本 #1）+ 昵称云端快照/可匿名。
export const main = withOpenId(async ({ db, OPENID, event }) => {
  const e: any = event
  const orderId = String(e.orderId || '')
  const productId = String(e.productId || '')
  const rating = Number(e.rating)
  if (!orderId || !productId) return err('BAD_ARGS')
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return err('BAD_RATING')
  const text = typeof e.text === 'string' ? e.text.trim().slice(0, 500) : ''
  const tags = (Array.isArray(e.tags) ? e.tags : [])
    .filter((t: any) => typeof t === 'string' && t.trim())
    .slice(0, 6)
    .map((t: string) => t.trim().slice(0, 10))

  // 订单归属 + 状态 + 商品在单内
  const got = await db.collection('orders').doc(orderId).get().catch(() => null)
  if (!got || !got.data || got.data._openid !== OPENID) return err('NOT_FOUND')
  if (got.data.status !== 'done') return err('NOT_DONE')
  const item = (got.data.items || []).find((it: any) => it.productId === productId)
  if (!item) return err('NOT_IN_ORDER')

  try {
    await db.createCollection('reviews')
  } catch {
    /* 已存在 */
  }
  const reviews = db.collection('reviews')
  // 确定性 _id：并发双发只有一条 add 成功（撞 _id 抛错即 REVIEWED），无 count 预检竞态窗口
  const _id = `${orderId}__${productId}`.slice(0, 128)

  let name = '匿名钩友'
  if (!e.anon) {
    const u = await db.collection('users').where({ _openid: OPENID }).get()
    name = (u.data[0] && u.data[0].nickname) || '鸭友'
  }

  const review = {
    _id,
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
  try {
    await reviews.add({ data: review })
  } catch {
    return err('REVIEWED') // _id 已存在 = 这单这件评过了
  }
  return ok()
})

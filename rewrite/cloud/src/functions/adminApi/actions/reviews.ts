import { reply, readDoc, type Ctx } from '../lib'
import { pageQuery, getTempUrls, IMAGE_URL_MAX_AGE, str, err } from '../../../kit'
import { COLLECTIONS } from '@ldrw/shared'

// 评价挑选（先审后发）：admin 看待挑选 + 已上架，勾上墙 / 撤下。公开读只认 picked===true。
// 未登记 ACTION_CAPS → 默认拒 admin:write＝仅超管。列表不回 _openid。

const LIST_LIMIT = 20

function adminFilter(data: Record<string, unknown>, db: Ctx['db']) {
  const filter: Record<string, unknown> = {}
  const productId = str(data.productId, 200).trim()
  if (productId) filter.productId = productId
  const status = str(data.status, 200) || 'all'
  if (status === 'picked') filter.picked = true
  else if (status === 'pending') filter.picked = db.command.neq(true) // false + 缺字段（旧档）
  return filter
}

export async function listReviews({ db, data }: Ctx) {
  const d = data || {}
  const paged = await pageQuery(db, COLLECTIONS.reviews, adminFilter(d, db), 'createdAt', d, LIST_LIMIT)
  const photoIds = paged.list.flatMap((r: any) =>
    (Array.isArray(r.photos) ? r.photos : []).filter(Boolean).map(String)
  )
  const urlMap = await getTempUrls(photoIds, { maxAge: IMAGE_URL_MAX_AGE, imageProc: true })
  const list = paged.list.map((r: any) => ({
    id: String(r._id || ''),
    productId: String(r.productId || ''),
    orderId: String(r.orderId || ''),
    name: String(r.name || ''),
    rating: Number(r.rating) || 0,
    tags: Array.isArray(r.tags) ? r.tags.map(String) : [],
    text: String(r.text || ''),
    spec: String(r.spec || ''),
    createdAt: Number(r.createdAt) || 0,
    photos: (Array.isArray(r.photos) ? r.photos : []).map((id: string) => urlMap[String(id)]).filter(Boolean),
    picked: r.picked === true,
  }))
  return reply(200, { ok: true, list, nextCursor: paged.nextCursor, hasMore: paged.hasMore })
}

export async function setReviewPicked({ db, data }: Ctx) {
  const id = str(data && data.id, 200)
  if (!id) return reply(400, err('NO_ID'))
  const picked = data.picked === true
  const upd = await db
    .collection(COLLECTIONS.reviews)
    .doc(id)
    .update({ data: { picked } })
    .catch(() => null)
  if (!upd || !upd.stats) return reply(400, err('NOT_FOUND'))
  // 真云内容没变回 updated:0（连点/别的窗口先点了同一状态），读回有这条就算成功
  if (upd.stats.updated !== 1) {
    const back = await readDoc(db.collection(COLLECTIONS.reviews).doc(id).get())
    if (!back.ok) return reply(200, err('DOC_READ_FAIL'))
    if (!back.data) return reply(400, err('NOT_FOUND'))
  }
  return reply(200, { ok: true, picked })
}

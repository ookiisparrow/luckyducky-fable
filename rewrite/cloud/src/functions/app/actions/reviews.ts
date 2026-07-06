import { ERR, COLLECTIONS } from '@ldrw/shared'
import { withOpenId, ok, err, getDb, pageQuery, getTempUrls, imgSecCheck } from '../../../kit'

/**
 * 求助面板辅助视频（黄金 §九）：两级（主题→小段）白名单下发；fileID 留服务端，
 * 批量换短时 URL（≤50/批·映射不串位）；无视频/换不到 → null（前端占位）。
 */
export const getHelpVideos = withOpenId(async ({ db }) => {
  const got = await db
    .collection(COLLECTIONS.content)
    .doc('helpVideos')
    .get()
    .catch(() => null)
  const items = (got?.data?.items || []) as any[]
  const allIds = items.flatMap((it) =>
    ((it.segments || []) as any[]).map((sg) => String(sg.videoFileId || '')).filter(Boolean)
  )
  const urlMap = await getTempUrls(allIds)
  const out = items.map((it) => ({
    id: String(it.id || ''),
    title: String(it.title || ''),
    sub: String(it.sub || ''),
    desc: String(it.desc || ''),
    segments: ((it.segments || []) as any[]).map((sg) => ({
      id: String(sg.id || ''),
      name: String(sg.name || ''),
      dur: String(sg.dur || ''),
      url: sg.videoFileId ? (urlMap[String(sg.videoFileId)] ?? null) : null,
    })),
  }))
  return ok({ items: out })
})

const SUMMARY_SAMPLE = 200

/** 精确汇总（黄金 §七：全量精确、永不近似）：星级桶 count + aggregate 求和，不受样本截断。 */
async function buildSummaryExact(db: any, productId: string) {
  const $ = db.command.aggregate
  const _ = db.command
  const coll = () => db.collection(COLLECTIONS.reviews)
  const [c5, c4, c3, c21, sumRes] = await Promise.all([
    coll().where({ productId, rating: 5 }).count(),
    coll().where({ productId, rating: 4 }).count(),
    coll().where({ productId, rating: 3 }).count(),
    coll().where({ productId, rating: _.in([1, 2]) }).count(), // 1 星并入 2 星档（与展示折叠一致）
    coll().aggregate().match({ productId }).group({ _id: null, s: $.sum('$rating') }).end(),
  ])
  const b5 = c5.total || 0
  const b4 = c4.total || 0
  const b3 = c3.total || 0
  const b2 = c21.total || 0
  const count = b5 + b4 + b3 + b2
  const sum = (sumRes && sumRes.list && sumRes.list[0] && sumRes.list[0].s) || 0
  const pct = (n: number) => (count ? Math.round((n / count) * 100) : 0)
  const tres = await coll()
    .where({ productId })
    .orderBy('createdAt', 'desc')
    .limit(SUMMARY_SAMPLE)
    .get()
    .catch(() => null)
  const tagCount: Record<string, number> = {}
  for (const r of tres ? tres.data : []) for (const t of r.tags || []) tagCount[t] = (tagCount[t] || 0) + 1
  return {
    score: count ? (sum / count).toFixed(1) : '0',
    count,
    approx: false, // 精确口径恒不标近似
    dist: [
      ['5 星', pct(b5)],
      ['4 星', pct(b4)],
      ['3 星', pct(b3)],
      ['2 星', pct(b2)],
    ],
    tags: Object.entries(tagCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5),
  }
}

/** 兜底汇总（聚合异常时的近样本口径·如实标 approx）。 */
function buildSummary(sample: any[]) {
  const count = sample.length
  let score = '0'
  const starCount: Record<number, number> = { 5: 0, 4: 0, 3: 0, 2: 0 }
  const tagCount: Record<string, number> = {}
  if (count) {
    let sum = 0
    for (const r of sample) {
      sum += r.rating
      starCount[Math.max(2, r.rating)]++
      for (const t of r.tags || []) tagCount[t] = (tagCount[t] || 0) + 1
    }
    score = (sum / count).toFixed(1)
  }
  const pct = (n: number) => (count ? Math.round((n / count) * 100) : 0)
  return {
    score,
    count,
    approx: count >= SUMMARY_SAMPLE,
    dist: [
      ['5 星', pct(starCount[5])],
      ['4 星', pct(starCount[4])],
      ['3 星', pct(starCount[3])],
      ['2 星', pct(starCount[2])],
    ],
    tags: Object.entries(tagCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5),
  }
}

/**
 * 按商品取评价（公开读·黄金 §七）：游标分页 + 首页全量精确汇总（翻页不重算，前端缓存）。
 */
export const getReviews = async (event: any = {}) => {
  const productId = String(event.productId || '')
  if (!productId) return err(ERR.NO_PRODUCT)
  const db = getDb()

  const paged = await pageQuery(db, COLLECTIONS.reviews, { productId }, 'createdAt', event, 20)
  // 买家秀晒图：受保护云存储 fileID 只在服务端，鉴权后批量换短时地址下发（不漏裸 fileID·黄金 §九同 helpVideos）。
  const photoIds = paged.list.flatMap((r: any) => (Array.isArray(r.photos) ? r.photos : []).filter(Boolean).map(String))
  const urlMap = await getTempUrls(photoIds)
  const list = paged.list.map((r: any) => ({
    name: r.name,
    rating: r.rating,
    tags: r.tags || [],
    text: r.text || '',
    spec: r.spec || '',
    createdAt: r.createdAt,
    photos: (Array.isArray(r.photos) ? r.photos : []).map((id: string) => urlMap[String(id)]).filter(Boolean), // 换不到的丢（占位）
  }))

  const isFirstPage = !(event && (event.cursor ?? null))
  let summary
  if (isFirstPage) {
    try {
      summary = await buildSummaryExact(db, productId)
    } catch {
      const sres = await db
        .collection(COLLECTIONS.reviews)
        .where({ productId })
        .orderBy('createdAt', 'desc')
        .limit(SUMMARY_SAMPLE)
        .get()
        .catch(() => null)
      summary = buildSummary(sres ? sres.data : [])
    }
  }

  return ok({ list, nextCursor: paged.nextCursor, hasMore: paged.hasMore, summary })
}

/**
 * 详情页评分摘要（公开只读·slim·C 类竖切）：热路径只跑 count + aggregate 求和 → {score,count}，
 * **不拉列表/晒图/标签**（详情页为一个分数拉 20 条评价+换临时图址是过度取数）。口径对齐 buildSummaryExact
 * 的精确均分（sum/count 保留一位）。只回聚合数、绝不带 _openid/评价明细（公开只读·隐私）。
 * 聚合异常/集合未建 → {score:'0',count:0}（前端 mapSummary count=0 → 不渲染假评·fail-closed）。
 */
export const getRatingSummary = async (event: any = {}) => {
  const productId = String(event.productId || '')
  if (!productId) return err(ERR.NO_PRODUCT)
  const db = getDb()
  const $ = db.command.aggregate
  try {
    const [cRes, sumRes] = await Promise.all([
      db.collection(COLLECTIONS.reviews).where({ productId }).count(),
      db.collection(COLLECTIONS.reviews).aggregate().match({ productId }).group({ _id: null, s: $.sum('$rating') }).end(),
    ])
    const count = cRes.total || 0
    const sum = (sumRes && sumRes.list && sumRes.list[0] && sumRes.list[0].s) || 0
    return ok({ score: count ? (sum / count).toFixed(1) : '0', count })
  } catch {
    return ok({ score: '0', count: 0 })
  }
}

/**
 * 提交评价（黄金 §七）：多重闸门（身份/评分 1–5/订单归属/已完成/商品在单内）；
 * 一单一行一评（确定性 _id=orderId__lineId 库级唯一·同商品多 SKU 各自可评）；匿名/昵称云端快照。
 */
export const submitReview = withOpenId(async ({ db, OPENID, event }) => {
  const e: any = event
  const orderId = String(e.orderId || '')
  const reqLine = String(e.lineId || e.productId || '')
  const rating = Number(e.rating)
  if (!orderId || !reqLine) return err(ERR.BAD_ARGS)
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return err(ERR.BAD_RATING)
  const text = typeof e.text === 'string' ? e.text.trim().slice(0, 500) : ''
  const tags = (Array.isArray(e.tags) ? e.tags : [])
    .filter((t: any) => typeof t === 'string' && t.trim())
    .slice(0, 6)
    .map((t: string) => t.trim().slice(0, 10))
  // 买家秀晒图（UGC·白名单收 cloud:// fileID·≤9 去空）；内容安全在闸门后校（见下）。
  const photos = (Array.isArray(e.photos) ? e.photos : [])
    .filter((p: any) => typeof p === 'string' && p)
    .slice(0, 9)
    .map((p: string) => p.slice(0, 256))

  const got = await db
    .collection(COLLECTIONS.orders)
    .doc(orderId)
    .get()
    .catch(() => null)
  if (!got || !got.data || got.data._openid !== OPENID) return err(ERR.NOT_FOUND)
  if (got.data.status !== 'done') return err(ERR.NOT_DONE)
  const item = (got.data.items || []).find((it: any) => (it.lineId || it.productId) === reqLine)
  if (!item) return err(ERR.NOT_IN_ORDER)
  const lineId = item.lineId || item.productId
  const productId = item.productId

  // UGC 晒图内容安全（fail-closed·根因#3·守卫 ugc-imgsecchecked）：闸门后逐张校，任一张违规/校不了
  // 一律拒、整条不落库——「证明安全」才放行（与 submitCheckpointPhoto 同闸）。
  for (const fid of photos) {
    const sec = await imgSecCheck(fid)
    if (!sec.ok) return err(sec.error === 'IMG_RISKY' ? 'IMG_RISKY' : 'SEC_CHECK_FAIL')
  }

  try {
    await db.createCollection(COLLECTIONS.reviews)
  } catch {
    /* 已存在 */
  }
  const _id = `${orderId}__${lineId}`.slice(0, 128)

  let name = '匿名钩友'
  if (!e.anon) {
    const u = await db.collection(COLLECTIONS.users).where({ _openid: OPENID }).get()
    name = (u.data[0] && u.data[0].nickname) || '鸭友'
  }

  try {
    await db.collection(COLLECTIONS.reviews).add({
      data: {
        _id,
        _openid: OPENID,
        orderId,
        lineId,
        productId,
        name,
        rating,
        tags,
        text,
        photos, // 已逐张过内容安全的 cloud:// fileID（读侧换短时址下发）
        spec: String(item.spec || ''),
        createdAt: Date.now(),
      },
    })
  } catch {
    return err(ERR.REVIEWED) // 撞主键 = 这单这行评过了（并发双发也只落一条）
  }
  return ok()
})

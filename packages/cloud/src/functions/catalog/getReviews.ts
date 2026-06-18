import { getDb, ok, err, pageQuery } from '../../kit'

// 按商品取评价列表 + 云端汇总（公开读，无需登录）。形状对齐前端 RatingSummary：
// { score, count, dist:[[label,pct]], tags:[[name,count]] }。
//
// 列表：cursor 游标分页（根因#7·债#13）——原 limit(200) 固定，>200 评价被挤出「全部评价」页；
//   现经 kit pageQuery 翻页（前端 nextCursor 渐进取全量），无参=首页兼容旧前端。
// 汇总：仅首页（无 cursor）返回，基于 bounded 样本（≤SUMMARY_SAMPLE·approx 标注）——真全量增量
//   聚合属院外债#13 后半（规模到再治），此处同 dashboard「近 N 估算」近似口径。
const SUMMARY_SAMPLE = 200

function buildSummary(sample: any[]) {
  const count = sample.length
  let score = '0'
  const starCount: Record<number, number> = { 5: 0, 4: 0, 3: 0, 2: 0 } // 1 星并入 2 星档
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
  const pct = (n: number) => (count ? Math.round((n / count) * 100) : 0) // structure-ok：占比百分比非金额
  return {
    score,
    count,
    approx: count >= SUMMARY_SAMPLE, // 样本封顶＝评分/分布基于近 N 估算（真全量院外债#13 后半）
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

export const main = async (event: any = {}) => {
  const productId = String(event.productId || '')
  if (!productId) return err('NO_PRODUCT')
  const db = getDb()

  // 列表：cursor 分页（默认 20/页），多查一条判 hasMore，返 nextCursor 供前端续取。
  const paged = await pageQuery(db, 'reviews', { productId }, 'createdAt', event, 20)
  const list = paged.list.map((r: any) => ({
    name: r.name,
    rating: r.rating,
    tags: r.tags || [],
    text: r.text || '',
    spec: r.spec || '',
    createdAt: r.createdAt,
  }))

  // 汇总只在首页（无 cursor）算一次——基于 bounded 样本，前端缓存复用、翻页不重算。
  const isFirstPage = !(event && (event.cursor ?? null))
  let summary
  if (isFirstPage) {
    const sres = await db
      .collection('reviews')
      .where({ productId })
      .orderBy('createdAt', 'desc')
      .limit(SUMMARY_SAMPLE)
      .get()
      .catch(() => null)
    summary = buildSummary(sres ? sres.data : [])
  }

  return ok({ list, nextCursor: paged.nextCursor, hasMore: paged.hasMore, summary })
}

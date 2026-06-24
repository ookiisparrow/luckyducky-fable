import { getDb, ok, err, pageQuery } from '../../kit'

// 按商品取评价列表 + 云端汇总（公开读，无需登录）。形状对齐前端 RatingSummary：
// { score, count, dist:[[label,pct]], tags:[[name,count]] }。
//
// 列表：cursor 游标分页（根因#7·债#13）——原 limit(200) 固定，>200 评价被挤出「全部评价」页；
//   现经 kit pageQuery 翻页（前端 nextCursor 渐进取全量），无参=首页兼容旧前端。
// 汇总（债#13 后半收尾·根因#7 固定样本失真）：评分/计数/星级分布走 count()+aggregate(sum)——精确、不封顶、
//   不受 200 样本截断（与 dashboard GMV 同范式·#18续，count/aggregate 真库已 loadtest capacity 模式证破千精确），
//   approx 恒 false。标签仍取近样本 top-5（标签是模糊「印象」、精确需 unwind 聚合·收益低，保留近似口径）。
//   兜底：聚合/计数异常退回 bounded 样本 buildSummary（零回归·根因#8 失败有兜底）。
const SUMMARY_SAMPLE = 200

// 精确汇总：4 次 count()（星级桶·1 星并入 2 星档）+ 1 次 aggregate 求评分和 → 全量精确，不读全部文档。
async function buildSummaryExact(db: any, productId: string) {
  const $ = db.command.aggregate
  const _ = db.command
  const coll = () => db.collection('reviews')
  const [c5, c4, c3, c21, sumRes] = await Promise.all([
    coll().where({ productId, rating: 5 }).count(),
    coll().where({ productId, rating: 4 }).count(),
    coll().where({ productId, rating: 3 }).count(),
    coll().where({ productId, rating: _.in([1, 2]) }).count(), // 2 星档含 1 星（与展示折叠一致）
    coll().aggregate().match({ productId }).group({ _id: null, s: $.sum('$rating') }).end(),
  ])
  const b5 = c5.total || 0
  const b4 = c4.total || 0
  const b3 = c3.total || 0
  const b2 = c21.total || 0
  const count = b5 + b4 + b3 + b2 // 全量（5 个星级全覆盖·rating 入库已校验 1–5）
  const sum = (sumRes && sumRes.list && sumRes.list[0] && sumRes.list[0].s) || 0
  const pct = (n: number) => (count ? Math.round((n / count) * 100) : 0) // structure-ok：占比百分比非金额
  // 标签：近样本 top-5（模糊印象·非精确口径）
  const tres = await coll().where({ productId }).orderBy('createdAt', 'desc').limit(SUMMARY_SAMPLE).get().catch(() => null)
  const tagCount: Record<string, number> = {}
  for (const r of tres ? tres.data : []) for (const t of r.tags || []) tagCount[t] = (tagCount[t] || 0) + 1
  return {
    score: count ? (sum / count).toFixed(1) : '0',
    count,
    approx: false, // 精确口径（count/aggregate 不封顶）——恒不标近似
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

  // 汇总只在首页（无 cursor）算一次——精确口径，前端缓存复用、翻页不重算。
  const isFirstPage = !(event && (event.cursor ?? null))
  let summary
  if (isFirstPage) {
    try {
      summary = await buildSummaryExact(db, productId)
    } catch {
      // 兜底：聚合/计数异常 → 退回 bounded 样本（零回归·根因#8 失败有兜底）
      const sres = await db
        .collection('reviews')
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

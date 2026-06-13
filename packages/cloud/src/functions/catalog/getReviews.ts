import { getDb, ok, err } from '../../kit'

// 按商品取评价列表 + 云端现算汇总（公开读，无需登录）。≤200 条内存聚合。
// 形状对齐前端 RatingSummary：{ score, count, dist:[[label,pct]], tags:[[name,count]] }。
export const main = async (event: any = {}) => {
  const productId = String(event.productId || '')
  if (!productId) return err('NO_PRODUCT')

  const db = getDb()
  const res = await db
    .collection('reviews')
    .where({ productId })
    .orderBy('createdAt', 'desc')
    .limit(200)
    .get()
    .catch(() => null)
  const list = (res ? res.data : []).map((r: any) => ({
    name: r.name,
    rating: r.rating,
    tags: r.tags || [],
    text: r.text || '',
    spec: r.spec || '',
    createdAt: r.createdAt,
  }))

  const count = list.length
  let score = '0'
  const starCount: Record<number, number> = { 5: 0, 4: 0, 3: 0, 2: 0 } // 1 星并入 2 星档
  const tagCount: Record<string, number> = {}
  if (count) {
    let sum = 0
    for (const r of list) {
      sum += r.rating
      starCount[Math.max(2, r.rating)]++
      for (const t of r.tags) tagCount[t] = (tagCount[t] || 0) + 1
    }
    score = (sum / count).toFixed(1)
  }
  const pct = (n: number) => (count ? Math.round((n / count) * 100) : 0)
  const summary = {
    score,
    count,
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
  return ok({ list, summary })
}

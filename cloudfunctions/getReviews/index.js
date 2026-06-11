// 按商品取评价列表 + 汇总（公开读侧，无需登录态）。
// 汇总在云端现算（≤200 条内存聚合，与 getDashboard 同思路）：
//   score 均分（1 位小数）/ dist 星级分布百分比 / tags 标签计数 Top5。
// 形状对齐前端 RatingSummary：{ score, count, dist:[[label,pct]], tags:[[name,count]] }。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event = {}) => {
  const productId = String(event.productId || '')
  if (!productId) return { ok: false, error: 'NO_PRODUCT' }

  const res = await db
    .collection('reviews')
    .where({ productId })
    .orderBy('createdAt', 'desc')
    .limit(200)
    .get()
    .catch(() => null)
  // 集合还没建（从没人评价过）也按空列表返回
  const list = (res ? res.data : []).map((r) => ({
    name: r.name,
    rating: r.rating,
    tags: r.tags || [],
    text: r.text || '',
    spec: r.spec || '',
    createdAt: r.createdAt,
  }))

  const count = list.length
  let score = '0'
  const starCount = { 5: 0, 4: 0, 3: 0, 2: 0 } // 1 星并入 2 星档（与样例四行布局一致）
  const tagCount = {}
  if (count) {
    let sum = 0
    for (const r of list) {
      sum += r.rating
      starCount[Math.max(2, r.rating)]++
      for (const t of r.tags) tagCount[t] = (tagCount[t] || 0) + 1
    }
    score = (sum / count).toFixed(1)
  }
  const pct = (n) => (count ? Math.round((n / count) * 100) : 0)
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
  return { ok: true, list, summary }
}

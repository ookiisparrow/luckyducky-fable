// 评价映射（纯函数·含星级拼装）。
import { dateTime } from './mapOrders'

export interface ReviewVM {
  name: string
  stars: string
  rating: number
  tags: string[]
  text: string
  spec: string
  photos: string[]
  timeLabel: string
}

/** 星级：实心+空心拼满 5 颗；越界钳 [0,5]。 */
export function stars(rating: unknown): string {
  const n = Math.max(0, Math.min(5, Math.round(Number(rating) || 0)))
  return '★'.repeat(n) + '☆'.repeat(5 - n)
}

/** 列表映射：评分非法（非 1-5）的脏行剔除（不渲染 0 星假评）。 */
export function mapReviews(list: unknown): ReviewVM[] {
  if (!Array.isArray(list)) return []
  const out: ReviewVM[] = []
  for (const r of list as Record<string, any>[]) {
    if (!r || typeof r !== 'object') continue
    const rating = Number(r.rating)
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) continue
    out.push({
      name: String(r.name || '鸭友'),
      stars: stars(rating),
      rating,
      tags: Array.isArray(r.tags) ? r.tags.map(String) : [],
      text: String(r.text || ''),
      spec: String(r.spec || ''),
      photos: Array.isArray(r.photos) ? r.photos.map(String).filter(Boolean) : [], // 云端已换短时址·空址剔除
      timeLabel: dateTime(r.createdAt).slice(5, 10), // 设计稿 A3 只写月-日「09-21」（YYYY-MM-DD HH:mm 取 MM-DD）
    })
  }
  return out
}

export interface SummaryVM {
  scoreLabel: string
  scoreStars: string
  count: number
  countLabel: string // approx＝云端只数了最近一批，写「近 N 条」
  dist: Array<{ label: string; pct: number; w: number }> // w＝亮条像素宽（6px 一格取整）
  tags: Array<{ tag: string; n: number }>
}

/** 汇总映射（**条数为 0 视同无数据**——返回 null 页面不渲染假汇总头）。 */
export function mapSummary(summary: unknown): SummaryVM | null {
  const s = (summary && typeof summary === 'object' ? summary : {}) as Record<string, any>
  const count = Number(s.count)
  if (!Number.isInteger(count) || count <= 0) return null
  return {
    scoreLabel: String(s.score || '0'),
    scoreStars: stars(s.score), // 摘要星行·由真实均分四舍五入派生（非写死）
    count,
    countLabel: (s.approx === true ? '近 ' : '') + count + ' 条评价',
    dist: (Array.isArray(s.dist) ? s.dist : [])
      .filter((d: any) => Array.isArray(d) && d.length >= 2)
      .map((d: any) => {
        const pct = Number(d[1]) || 0
        // 设计稿 logic：24 格×6px（每格 4 亮 2 缝），按占比取整——不会切在半格上。
        // 有评分的星级至少亮 1 格；0%（含脏值）一格不亮（老板拍板 7）
        const cells = pct > 0 ? Math.min(24, Math.max(1, Math.round((pct / 100) * 24))) : 0
        return { label: String(d[0]), pct, w: cells ? cells * 6 - 2 : 0 }
      }),
    tags: (Array.isArray(s.tags) ? s.tags : [])
      .filter((t: any) => Array.isArray(t) && t[0])
      .map((t: any) => ({ tag: String(t[0]), n: Number(t[1]) || 0 })),
  }
}

/** 标签筛选（设计稿 A3 点标签只看带该标签的评价）：第 from 条起每行藏不藏。tag 空＝全显示。
 *  接口不支持按标签拉列表，只能筛已加载的行——页面在匹配太少时继续往下翻页补齐。 */
export function hiddenByTag(list: ReviewVM[], tag: string, from = 0): boolean[] {
  return list.slice(from).map((r) => !!tag && !r.tags.includes(tag))
}

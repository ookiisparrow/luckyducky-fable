// 评价映射（纯函数·黄金 learning-content §七 + frontend-store §四星级拼装）（守卫 rw-mp-reviews-golden）。
import { dateTime } from './mapOrders'

export interface ReviewVM {
  name: string
  stars: string
  rating: number
  tags: string[]
  text: string
  spec: string
  timeLabel: string
}

/** 星级：实心+空心拼满 5 颗（黄金 §四）；越界钳 [0,5]。 */
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
      timeLabel: dateTime(r.createdAt),
    })
  }
  return out
}

export interface SummaryVM {
  scoreLabel: string
  count: number
  dist: Array<{ label: string; pct: number }>
  tags: Array<{ tag: string; n: number }>
}

/** 汇总映射（黄金 §七读取半边：**条数为 0 视同无数据**——返回 null 页面不渲染假汇总头）。 */
export function mapSummary(summary: unknown): SummaryVM | null {
  const s = (summary && typeof summary === 'object' ? summary : {}) as Record<string, any>
  const count = Number(s.count)
  if (!Number.isInteger(count) || count <= 0) return null
  return {
    scoreLabel: String(s.score || '0'),
    count,
    dist: (Array.isArray(s.dist) ? s.dist : [])
      .filter((d: any) => Array.isArray(d) && d.length >= 2)
      .map((d: any) => ({ label: String(d[0]), pct: Number(d[1]) || 0 })),
    tags: (Array.isArray(s.tags) ? s.tags : [])
      .filter((t: any) => Array.isArray(t) && t[0])
      .map((t: any) => ({ tag: String(t[0]), n: Number(t[1]) || 0 })),
  }
}

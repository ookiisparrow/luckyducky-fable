// 评价挑选行映射（纯函数）：时间人话化；picked 只认 ===true（缺字段＝待挑选）。
import { dateTime } from './format'

export interface ReviewRowVM {
  id: string
  productId: string
  orderId: string
  name: string
  rating: number
  tags: string[]
  text: string
  spec: string
  timeLabel: string
  photos: string[]
  picked: boolean
}

export function mapReviewRows(list: unknown): ReviewRowVM[] {
  if (!Array.isArray(list)) return []
  return (list as Record<string, any>[]).filter((e) => e && typeof e === 'object' && e.id).map((e) => ({
    id: String(e.id || ''),
    productId: String(e.productId || ''),
    orderId: String(e.orderId || ''),
    name: String(e.name || ''),
    rating: Number(e.rating) || 0,
    tags: Array.isArray(e.tags) ? e.tags.map(String) : [],
    text: String(e.text || ''),
    spec: String(e.spec || ''),
    timeLabel: dateTime(e.createdAt),
    photos: Array.isArray(e.photos) ? e.photos.map(String).filter(Boolean) : [],
    picked: e.picked === true,
  }))
}

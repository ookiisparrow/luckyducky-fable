// 评价挑选 api（薄封装）
// 回包类型取 @ldrw/shared 的后台契约
import type { AdminReviewsPage, AdminReviewPicked } from '@ldrw/shared'
import { typedPost } from './index'

export const listReviews = (filter: { cursor?: unknown; limit?: number; status?: string; productId?: string } = {}) =>
  typedPost<AdminReviewsPage>('listReviews', filter as Record<string, unknown>)

export const setReviewPicked = (id: string, picked: boolean) => typedPost<AdminReviewPicked>('setReviewPicked', { id, picked })

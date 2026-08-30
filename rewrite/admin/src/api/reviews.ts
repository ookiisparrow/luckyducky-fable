// 评价挑选 api（薄封装）
import { client } from './index'

export const listReviews = (filter: { cursor?: unknown; limit?: number; status?: string; productId?: string } = {}) =>
  client.post('listReviews', filter as Record<string, unknown>)

export const setReviewPicked = (id: string, picked: boolean) => client.post('setReviewPicked', { id, picked })

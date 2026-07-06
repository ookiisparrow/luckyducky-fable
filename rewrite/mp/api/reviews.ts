// 评价域 api（经 app 网关·提交闸门/一单一行一评/昵称快照全在云端）
import { callApp, type ApiResult } from '../utils/cloud'

export const getReviews = (productId: string, cursor?: unknown, limit = 20): Promise<ApiResult> => callApp('getReviews', { productId, cursor, limit })
export const submitReview = (orderId: string, lineId: string, rating: number, text: string, tags: string[], anon: boolean, photos: string[] = []): Promise<ApiResult> =>
  callApp('submitReview', { orderId, lineId, rating, text, tags, anon, photos })

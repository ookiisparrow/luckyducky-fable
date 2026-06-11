/**
 * 评价接口。读侧 getReviews（公开，按商品取列表 + 汇总）；写侧 submitReview
 * （敏感业务走云函数：订单归属 / 已完成 / 一单一品一评，昵称云端快照）。
 * H5 / App 无云：读侧返回 null（页面回退样例），写侧返回 null（页面走演示 Toast）。
 * 页面不直接调这里，读侧统一经 store/reviews.js 收口。
 */
import { callCloud } from '@/utils/cloud.js'
import { logger } from '@/utils/logger.js'

// 返回 { list, summary } 或 null（无云 / 云端失败，由调用方回退样例）
export async function getReviews(productId) {
  try {
    const res = await callCloud('getReviews', { productId })
    if (res?.ok) return { list: res.list, summary: res.summary }
  } catch (e) {
    logger.warn('review', 'getReviews 云端失败，回退样例', e)
  }
  return null
}

// 提交评价。成功 { ok:true }；云函数拒绝向上抛（页面按 error 提示，如 REVIEWED）；
// 无云（H5 / App 演示）返回 null，页面走原 Toast 路径。
export async function submitReview(payload) {
  const res = await callCloud('submitReview', payload)
  if (res === null) return null
  if (!res.ok) throw new Error(res.error || 'SUBMIT_FAILED')
  return res
}

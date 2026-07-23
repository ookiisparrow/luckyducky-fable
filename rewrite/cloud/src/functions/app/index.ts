import { ERR, moduleOfAction } from '@ldrw/shared'
import { err, recordAnomaly } from '../../kit'
import { login, updateProfile } from './actions/user'
import { getProducts, getProductDetail, getContent, getPageContent } from './actions/catalog'
import {
  activateCourse,
  confirmEnter,
  getCourses,
  getPlaybackUrl,
  getMyCourses,
  getMyProgress,
  trackEvent,
} from './actions/learning'
import { getHelpVideos, getReviews, getRatingSummary, submitReview } from './actions/reviews'
import { getPublicFaq } from './actions/faq'
import {
  createOrder,
  pay,
  applyRefund,
  confirmReceive,
  cancelOrder,
  getMyOrders,
  getOrderById,
  getMyAfterSales,
} from './actions/orders'
import { kfBind, dataConsent } from './actions/cs'
import { submitFeedback } from './actions/feedback'
import { submitCheckpointPhoto } from './actions/checkpoint'

/**
 * 用户端聚合网关（蓝图定案·adminApi registry 范式）：event = { action, data }。
 * 每个 action 模块自带完整闸（withOpenId/withRateLimit…），注册表只做分发；
 * 未知 action fail-closed 拒（设计约束#3）。M5 切换日小程序 callFunction('app', {action,data})。
 */
const ACTIONS: Record<string, (event: unknown) => Promise<unknown>> = {
  login,
  updateProfile,
  getProducts,
  getProductDetail,
  getContent,
  getPageContent,
  activateCourse,
  confirmEnter,
  getCourses,
  getPlaybackUrl,
  getMyCourses,
  getMyProgress,
  trackEvent,
  getHelpVideos,
  getPublicFaq,
  getReviews,
  getRatingSummary,
  submitReview,
  createOrder,
  pay,
  applyRefund,
  confirmReceive,
  cancelOrder,
  getMyOrders,
  getOrderById,
  getMyAfterSales,
  kfBind,
  dataConsent,
  submitFeedback,
  submitCheckpointPhoto,
}

export const main = async (event: any) => {
  const action = String(event?.action ?? '')
  const handler = ACTIONS[action]
  if (!handler) return err(ERR.BAD_ARGS, { action })
  try {
    return await handler(event?.data ?? {})
  } catch (e) {
    // 顶层兜底（课程链路审计 2026-07-17·根因#14）：action 内没被 try/catch 覆盖的写路径异常（DB 瞬时
    // 抖动/SDK 抛错）原来一路冒出 main——调用方只见 fail 回调，anomalies 账本零记录、对开发者彻底沉默
    // （raw 平台日志没人主动翻，见 observe.ts 头注）。收敛进账本（fp 按 action 细分、high 首见即告警）
    // 后回统一错误码；recordAnomaly 自身 fail-soft，不会反噬。
    await recordAnomaly(
      'server-exception',
      'APP_ACTION_UNCAUGHT',
      // module：按模块正册归因（车队地基批2·modules.json→moduleMap 镜像·守卫 module-map-synced 焊死）
      { fp: action, action, module: moduleOfAction(action), msg: String((e as Error)?.message || e).slice(0, 200) },
      'high'
    )
    return err(ERR.INTERNAL)
  }
}

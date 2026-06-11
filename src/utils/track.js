/**
 * 通用埋点出口（规格 §七 事件模型）。同 logger 思路：业务代码只调 track()，上报细节收口在此。
 * fire-and-forget：不 await、失败仅 warn，绝不阻塞交互。
 * 小程序端走云函数 trackEvent（events 流水 + segment 进度折叠，一次埋点两用）；
 * H5 / App 端无云为空操作。
 *
 * 用法：track('segment_done', { page: 'player', targetId: segId, meta: { courseId, lessonId, at, dur } })
 */
import { callCloud } from '@/utils/cloud.js'
import { logger } from '@/utils/logger.js'

export function track(type, { page = '', targetId = '', meta = {} } = {}) {
  if (!type) return
  callCloud('trackEvent', { type, page, targetId, meta }).catch((e) =>
    logger.warn('track', type + ' 上报失败', e),
  )
}

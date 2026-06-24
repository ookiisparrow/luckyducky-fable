/**
 * 意见反馈接口（运营钩子①·待办#23）。
 *
 * submitFeedback：小程序端走云函数 submitFeedback（openid 闸 + 频控 + 白名单字段，云端只写本人）；
 *   H5 / App 端无云能力，返回 null，由调用方据此提示「请在微信小程序内反馈」。
 *   入参 { category?, content, contact? }；成功返回 true，失败 / 无云返回 false。
 */
import { callCloud } from '@/utils/cloud.js'
import { logger } from '@/utils/logger.js'

export async function submitFeedback({ category = 'other', content = '', contact = '' } = {}) {
  try {
    // 附端上下文便于运营复现（page 由云端默认空；platform/version 用于区分多端 / 版本）
    const res = await callCloud('submitFeedback', {
      category,
      content,
      contact,
      // #ifdef MP-WEIXIN
      platform: 'mp-weixin',
      // #endif
    })
    if (res?.ok) return true
    if (res) logger.warn('feedback', 'submitFeedback 云端拒绝', res)
  } catch (e) {
    logger.warn('feedback', 'submitFeedback 云端失败', e)
  }
  return false
}

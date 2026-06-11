/**
 * 学习进度接口。
 * getMyProgress：小程序端走云函数（trackEvent 折叠写入的紧凑进度文档，segment 粒度）；
 *   H5 / App 端无云返回 null，由 store/progress.js 回退样例 SAMPLE_PROGRESS。
 *   页面不直接调这里，统一经 store/progress.js 收口。
 */
import { callCloud } from '@/utils/cloud.js'
import { logger } from '@/utils/logger.js'

export async function getMyProgress() {
  try {
    const res = await callCloud('getMyProgress')
    if (res?.ok && Array.isArray(res.list)) return res.list
  } catch (e) {
    logger.warn('progress', 'getMyProgress 云端失败', e)
  }
  return null
}

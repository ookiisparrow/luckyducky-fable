/**
 * 求助面板「辅助视频」接口（全局共用·所有课程同一份）。
 * 走云函数 getHelpVideos（控制台「帮助视频」编辑后的内容），返回
 *   [{ id, title, sub, desc, dur, url }]，url = 服务端换的短时效临时地址（无视频则 null）。
 * 审计 P1：videoFileId 不出接口，前端只拿临时 URL（守卫 help-video-url-via-cloud-only）。
 * 云端无记录 / H5·App 无云 → 空数组，求助面板显空态。
 */
import { callCloud } from '@/utils/cloud.js'
import { logger } from '@/utils/logger.js'

export async function getHelpVideos() {
  try {
    const res = await callCloud('getHelpVideos')
    if (res?.ok && Array.isArray(res.items)) return res.items
  } catch (e) {
    logger.warn('help', 'getHelpVideos 云端失败', e)
  }
  return []
}

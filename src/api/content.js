/**
 * 首页内容接口（hero 文案 / 信任条 / FAQ）。
 * 小程序端走云函数 getContent（控制台「小程序橱窗」编辑后的内容）；
 * H5 / App 或云端无记录时返回 null，由 store/content.js 回退本地默认文案。
 * 页面不直接调这里，统一经 store/content.js 收口。
 */
import { callCloud } from '@/utils/cloud.js'
import { logger } from '@/utils/logger.js'

export async function getHomeContent() {
  try {
    const res = await callCloud('getContent')
    if (res?.ok) return res.home // 可能为 null（未编辑过）
  } catch (e) {
    logger.warn('content', 'getContent 云端失败，回退默认文案', e)
  }
  return null
}

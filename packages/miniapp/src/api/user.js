/**
 * 用户资料接口。
 *
 * updateProfile：小程序端走云函数 updateProfile（openid 闸门 + 白名单字段，云端只改本人记录）；
 *   H5 / App 端无云能力，返回 null，由调用方（store/user.js）保留纯本地保存。
 *   入参 { nickname, avatar, bio }；成功返回云端最新 user 文档，失败 / 无云返回 null。
 */
import { callCloud } from '@/utils/cloud.js'
import { logger } from '@/utils/logger.js'

export async function updateProfile(patch) {
  try {
    const res = await callCloud('updateProfile', patch)
    if (res?.ok && res.user) return res.user
    if (res) logger.warn('user', 'updateProfile 云端拒绝', res)
  } catch (e) {
    logger.warn('user', 'updateProfile 云端失败', e)
  }
  return null
}

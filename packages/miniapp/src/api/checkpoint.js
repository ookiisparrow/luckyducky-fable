/**
 * 节点诊断·拍照上传接口（后台360工作站 B2.2）。
 *
 * submitCheckpointPhoto：先把本地照片传云存储拿 fileID，再调云函数 submitCheckpointPhoto——
 *   云端做 openid 闸 + 频控 + 进课校验 + imgSecCheck 内容安全（fail-closed·违规/校不了不入库），只写本人。
 *   H5 / App 端无云能力，uploadCloudFile 返回 null → 返回 { ok:false, error:'NO_CLOUD' }，由调用方提示。
 *   入参 { courseId, nodeId, filePath（本地临时路径） }；成功 { ok:true }，失败 { ok:false, error }。
 */
import { callCloud, uploadCloudFile } from '@/utils/cloud.js'
import { logger } from '@/utils/logger.js'

export async function submitCheckpointPhoto({ courseId, nodeId, filePath } = {}) {
  if (!courseId || !nodeId || !filePath) return { ok: false, error: 'BAD_ARGS' }
  try {
    const cloudPath = `checkpoints/${courseId}/${nodeId}-${Date.now()}.jpg`
    const fileId = await uploadCloudFile(cloudPath, filePath)
    if (!fileId) return { ok: false, error: 'NO_CLOUD' } // 非小程序端无云存储
    const res = await callCloud('submitCheckpointPhoto', { courseId, nodeId, fileId })
    if (res?.ok) return { ok: true }
    return { ok: false, error: (res && res.error) || 'FAIL' }
  } catch (e) {
    logger.warn('checkpoint', 'submitCheckpointPhoto 失败', e)
    return { ok: false, error: 'FAIL' }
  }
}

// 内容组 api（首页内容/帮助视频/课程与视频直传）。
// 直传（调试日志 G）：getVideoUploadMeta 签发凭证 → POST 表单直传 COS（PUT 会 403）；
// 失败如实报错（分片回落通道随补——待办记账·不静默装成功）。
import { client } from './index'
import { uploadFormFields } from '../lib/mapContent'

export const getHomeContent = () => client.post('getHomeContent')
export const saveHomeContent = (home: Record<string, unknown>) => client.post('saveHomeContent', { home })
// 页面内容 CMS（批C·五页签，云端 adminApi/content.ts）：page ∈ welcome|catalogPlayer|mePage|about|agreement
export const getPageContent = (page: string) => client.post('getPageContent', { page })
export const savePageContent = (page: string, data: Record<string, unknown>) => client.post('savePageContent', { page, data })
export const listHelpVideos = () => client.post('listHelpVideos')
export const saveHelpVideos = (items: unknown[]) => client.post('saveHelpVideos', { items })
export const getCourseDraft = (courseId: string) => client.post('getCourseDraft', { courseId })
// baseRev＝拉草稿时的版本号（乐观并发·课程链路审计 2026-07-17）：不符后端回 DRAFT_CONFLICT 拒覆盖
export const saveCourseDraft = (course: Record<string, unknown>, baseRev?: number) => client.post('saveCourseDraft', { course, baseRev })
export const publishCourse = (courseId: string) => client.post('publishCourse', { courseId })

/** 视频直传：换凭证 → POST 表单 → 返回 videoFileId（cloud://）。onProgress 0-1。 */
export async function uploadVideo(courseId: string, segName: string, file: File, onProgress?: (p: number) => void): Promise<{ ok: boolean; fileId?: string; error?: string }> {
  const ext = /\.mov$/i.test(file.name) ? 'mov' : 'mp4'
  const meta = await client.post('getVideoUploadMeta', { courseId, name: segName, ext })
  if (!meta.ok) return { ok: false, error: String(meta.error || 'META_UNAVAILABLE') }
  const fields = uploadFormFields(meta as never)
  if (!fields) return { ok: false, error: 'META_INCOMPLETE' } // 凭证不齐不发
  try {
    await new Promise<void>((resolve, reject) => {
      const fd = new FormData()
      for (const [k, v] of Object.entries(fields)) fd.append(k, v)
      fd.append('file', file)
      const xhr = new XMLHttpRequest()
      xhr.open('POST', String(meta.url)) // 只认 POST 表单（调试日志 G·PUT 403）
      if (xhr.upload && onProgress) xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total)
      xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error('直传失败 HTTP ' + xhr.status)))
      xhr.onerror = () => reject(new Error('直传网络错误'))
      xhr.send(fd)
    })
    return { ok: true, fileId: String(meta.fileId) }
  } catch (e) {
    return { ok: false, error: String(e instanceof Error ? e.message : e) } // 原文不吞
  }
}

/** 定格动画帧直传（首页 36 帧 scrub 层 + 1080² 定格层）：同 uploadVideo 的凭证通道，只换 action。
 *  slot＝帧序 0..35 或 'hero'（决定云端对象路径）；入参恒 jpg——帧已在浏览器端 canvas 降采样成定尺 JPEG，
 *  不劳 CDN 实时缩放。传的是 Blob 而非 File（canvas.toBlob 产物），FormData 两者同构。 */
export async function uploadFrameImage(slot: string | number, blob: Blob, onProgress?: (p: number) => void): Promise<{ ok: boolean; fileId?: string; error?: string }> {
  const meta = await client.post('getFrameUploadMeta', { slot, ext: 'jpg' })
  if (!meta.ok) return { ok: false, error: String(meta.error || 'META_UNAVAILABLE') }
  const fields = uploadFormFields(meta as never)
  if (!fields) return { ok: false, error: 'META_INCOMPLETE' } // 凭证不齐不发
  try {
    await new Promise<void>((resolve, reject) => {
      const fd = new FormData()
      for (const [k, v] of Object.entries(fields)) fd.append(k, v)
      fd.append('file', blob)
      const xhr = new XMLHttpRequest()
      xhr.open('POST', String(meta.url)) // 只认 POST 表单（调试日志 G·PUT 403）
      if (xhr.upload && onProgress) xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total)
      xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error('直传失败 HTTP ' + xhr.status)))
      xhr.onerror = () => reject(new Error('直传网络错误'))
      xhr.send(fd)
    })
    return { ok: true, fileId: String(meta.fileId) }
  } catch (e) {
    return { ok: false, error: String(e instanceof Error ? e.message : e) } // 原文不吞
  }
}

// 内容组 api（首页内容/帮助视频/课程与视频直传）。
// 直传（调试日志 G）：getVideoUploadMeta 签发凭证 → POST 表单直传 COS（PUT 会 403）；
// 失败如实报错（分片回落通道随补——待办记账·不静默装成功）。
import { client } from './index'
import { uploadFormFields } from '../lib/mapContent'

export const getHomeContent = () => client.post('getHomeContent')
export const saveHomeContent = (home: Record<string, unknown>) => client.post('saveHomeContent', { home })
export const listHelpVideos = () => client.post('listHelpVideos')
export const saveHelpVideos = (items: unknown[]) => client.post('saveHelpVideos', { items })
export const getCourseDraft = (courseId: string) => client.post('getCourseDraft', { courseId })
export const saveCourseDraft = (course: Record<string, unknown>) => client.post('saveCourseDraft', { course })
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

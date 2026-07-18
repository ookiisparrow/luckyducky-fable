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
// 转码状态同步（决策§29 批2·on-demand 拉模式）：就绪段回写 vodUrl/封面/雪碧图/时长·rev 递增（调用方须重载草稿）
export const syncVodMedia = (courseId: string) => client.post('syncVodMedia', { courseId })

// —— VOD 直传（决策§29 转码管线批2·课程视频主路径升级）——签名派发经 adminApi（kit/vod UGC 签名），
// 浏览器 vod-js-sdk-v6 直传 VOD 并经 procedure 自动触发转码任务流。未配置（VOD_NOT_CONFIGURED）自动
// 回退下方云存储直传老路——配置填入即切换、零部署零操作变化；帮助视频线（HelpVideos）恒走老路不迁。
let vodSig: { sig: string | null; exp: number } | null = null
async function getVodSignature(): Promise<string | null> {
  if (vodSig && Date.now() < vodSig.exp) return vodSig.sig
  const r = await client.post('getVodUploadSignature')
  vodSig = { sig: r.ok ? String(r.signature) : null, exp: Date.now() + 5 * 60_000 } // 负结果同缓 5min：批量百段不重复探测
  return vodSig.sig
}

async function uploadVideoVod(file: File, onProgress?: (p: number) => void): Promise<{ ok: boolean; fileId?: string; error?: string }> {
  try {
    const TcVod = (await import('vod-js-sdk-v6')).default // 动态引入：未配置 VOD 的会话不载 SDK
    const uploader = new TcVod({ getSignature: async () => (await getVodSignature()) || '' }).upload({ mediaFile: file })
    if (onProgress) uploader.on('media_progress', (info: { percent?: number }) => onProgress(Number(info?.percent) || 0))
    const done = await uploader.done()
    const fileId = String((done as { fileId?: string })?.fileId || '')
    if (!fileId) return { ok: false, error: 'VOD_NO_FILEID' }
    return { ok: true, fileId } // 纯数字 FileId（isVodFileId 判据·转码就绪前段显示「转码中」）
  } catch (e) {
    return { ok: false, error: String(e instanceof Error ? e.message : e) } // 原文不吞（同老路口径）
  }
}

/** 视频直传：VOD 已配置走 VOD（返回纯数字 FileId），否则走云存储老路（返回 cloud:// fileID）。onProgress 0-1。 */
export async function uploadVideo(courseId: string, segName: string, file: File, onProgress?: (p: number) => void): Promise<{ ok: boolean; fileId?: string; error?: string }> {
  if (await getVodSignature()) return uploadVideoVod(file, onProgress)
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

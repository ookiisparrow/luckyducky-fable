// 内容组 api（首页内容/帮助视频/课程与视频直传）。
// 直传：getVideoUploadMeta 签发凭证 → POST 表单直传 COS（PUT 会 403）；
// 失败如实报错（不静默装成功）。
// 回包类型取 @ldrw/shared 的后台契约
import type {
  AdminHomeContent,
  AdminPageContent,
  AdminHelpVideos,
  AdminRev,
  AdminCourseDraft,
  AdminVodSynced,
  AdminVodSignature,
  AdminVideoUploadMeta,
} from '@ldrw/shared'
import { typedPost } from './index'
import { uploadFormFields } from '../lib/mapContent'

export const getHomeContent = () => typedPost<AdminHomeContent>('getHomeContent')
export const saveHomeContent = (home: Record<string, unknown>) => typedPost<object>('saveHomeContent', { home })
// 页面内容 CMS（五页签，云端 adminApi/content.ts）：page ∈ welcome|catalogPlayer|mePage|about|agreement
export const getPageContent = (page: string) => typedPost<AdminPageContent>('getPageContent', { page })
export const savePageContent = (page: string, data: Record<string, unknown>) => typedPost<object>('savePageContent', { page, data })
export const listHelpVideos = () => typedPost<AdminHelpVideos>('listHelpVideos')
// baseRev＝拉取时的版本号（乐观并发）：不符后端回 DRAFT_CONFLICT 拒覆盖·防双页签互吃 + 误 GC 删视频
// 失败包 rev：DRAFT_CONFLICT 带库里现有版本，GC_DELETE_FAIL（内容已落库）带写后版本
export const saveHelpVideos = (items: unknown[], baseRev?: number) => typedPost<AdminRev, AdminRev>('saveHelpVideos', { items, baseRev })
export const getCourseDraft = (courseId: string) => typedPost<AdminCourseDraft>('getCourseDraft', { courseId })
// baseRev＝拉草稿时的版本号（乐观并发）：不符后端回 DRAFT_CONFLICT 拒覆盖
export const saveCourseDraft = (course: Record<string, unknown>, baseRev?: number) => typedPost<AdminRev>('saveCourseDraft', { course, baseRev })
// VOD_PROCESSING 失败包带 pending＝仍在转码的段数
export const publishCourse = (courseId: string) => typedPost<object, { pending: number }>('publishCourse', { courseId })
// 转码状态同步（决策§31·on-demand 拉模式）：就绪段回写 vodUrl/封面/雪碧图/时长·rev 递增（调用方须重载草稿）
export const syncVodMedia = (courseId: string) => typedPost<AdminVodSynced>('syncVodMedia', { courseId })

// —— VOD 直传（决策§31·课程视频主路径）——签名派发经 adminApi（kit/vod UGC 签名），
// 浏览器 vod-js-sdk-v6 直传 VOD 并经 procedure 自动触发转码任务流。未配置（VOD_NOT_CONFIGURED）自动
// 回退下方云存储直传老路——配置填入即切换、零部署零操作变化；帮助视频线（HelpVideos）恒走老路不迁。
let vodSig: { sig: string | null; exp: number } | null = null
async function getVodSignature(): Promise<string | null> {
  if (vodSig && Date.now() < vodSig.exp) return vodSig.sig
  const r = await typedPost<AdminVodSignature>('getVodUploadSignature')
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

/**
 * 视频直传。**走 VOD 须显式 opt-in `allowVod`**（默认云存储老路·fail-safe）：
 * 本函数为课程视频与帮助视频**共用**——课程线（Courses.vue）传 `{ allowVod: true }` 走 VOD（转码/发布闸/
 * 播放签名整链已建）；帮助视频线（HelpVideos.vue）**恒不传**——其播放侧 `getHelpVideos` 只认云存储 fileID
 * （getTempUrls 批量换址·无 vodUrl 字段、无转码同步、无发布闸兜底），传进 VOD 即换不到地址、求助面板视频
 * 静默全哑（「VOD 配了就走 VOD」会漏掉这个调用面，且机器闸与测试对跨线影响全绿、拦不住）。
 * 返回 fileId：VOD 线=纯数字 FileId，云存储线=`cloud://` fileID。onProgress 0-1。
 */
export async function uploadVideo(
  courseId: string,
  segName: string,
  file: File,
  onProgress?: (p: number) => void,
  opts?: { allowVod?: boolean }
): Promise<{ ok: boolean; fileId?: string; error?: string }> {
  if (opts?.allowVod && (await getVodSignature())) return uploadVideoVod(file, onProgress)
  const ext = /\.mov$/i.test(file.name) ? 'mov' : 'mp4'
  const meta = await typedPost<AdminVideoUploadMeta>('getVideoUploadMeta', { courseId, name: segName, ext })
  if (!meta.ok) return { ok: false, error: String(meta.error || 'META_UNAVAILABLE') }
  const fields = uploadFormFields(meta)
  if (!fields) return { ok: false, error: 'META_INCOMPLETE' } // 凭证不齐不发
  try {
    await new Promise<void>((resolve, reject) => {
      const fd = new FormData()
      for (const [k, v] of Object.entries(fields)) fd.append(k, v)
      fd.append('file', file)
      const xhr = new XMLHttpRequest()
      xhr.open('POST', String(meta.url)) // 只认 POST 表单（PUT 403）
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

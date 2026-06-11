/**
 * 云适配层（业务代码不直接碰后端，换后端只改这里）。双模式：
 *
 * - 云模式（生产）：admin/.env.local 配 VITE_ADMIN_API=https://<env>.service.tcloudbase.com/adminapi
 *   → 经 HTTP 访问服务调云函数 adminApi（管理口令校验，sha256 入库；首次登录即设置口令）。
 *   商品草稿存云端 productsDraft，图片传云存储（fileID 与小程序同一环境）。
 * - 本地模式（演示/无网开发）：不配 VITE_ADMIN_API 时数据存 localStorage、图片压成 dataURL。
 *
 * 规格：docs/设计规格-管理控制台.md §三/§七（登录方案 v1 = HTTP 服务 + 管理口令，
 * CloudBase Web SDK 账号体系留作升级）。
 */

const API_BASE = import.meta.env.VITE_ADMIN_API || ''
export const cloudMode = !!API_BASE

const AUTH_KEY = 'ld_admin_auth'
const DATA_KEY = 'ld_admin_products'

// ---------- 会话 ----------

export function isLoggedIn() {
  return !!localStorage.getItem(AUTH_KEY)
}
export function currentUser() {
  try {
    return JSON.parse(localStorage.getItem(AUTH_KEY))?.username || ''
  } catch {
    return ''
  }
}
export function logout() {
  localStorage.removeItem(AUTH_KEY)
}
function session() {
  try {
    return JSON.parse(localStorage.getItem(AUTH_KEY)) || {}
  } catch {
    return {}
  }
}

async function post(action, data = {}) {
  const res = await fetch(API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, key: session().key || '', data }),
  })
  const r = await res.json()
  // 网关层错误（如请求体超限）没有 ok 字段，转成可读错误抛出
  if (r.ok === undefined && r.code) throw new Error(`网关拒绝（${r.code}）`)
  return r
}

export async function login(username, password) {
  if (!username || !password) return { ok: false, error: '请输入账号与密码' }
  if (!cloudMode) {
    localStorage.setItem(AUTH_KEY, JSON.stringify({ username, at: Date.now() }))
    return { ok: true }
  }
  try {
    const res = await fetch(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'login', key: password }),
    })
    const r = await res.json()
    if (!r.ok) {
      const msg = { KEY_TOO_SHORT: '口令至少 6 位', BAD_KEY: '口令不正确' }[r.error] || '登录失败'
      return { ok: false, error: msg }
    }
    // 口令留在本机用于后续请求签发（单管理员 v1；升级账号体系后移除）
    localStorage.setItem(AUTH_KEY, JSON.stringify({ username, key: password, at: Date.now() }))
    return { ok: true, bootstrapped: r.bootstrapped }
  } catch {
    return { ok: false, error: '连不上服务，请检查网络' }
  }
}

// ---------- 商品草稿 ----------

function localList() {
  try {
    const list = JSON.parse(localStorage.getItem(DATA_KEY))
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}
function localSave(list) {
  localStorage.setItem(DATA_KEY, JSON.stringify(list))
}

// 返回 { list, urls }：urls 为 fileID → 可显示 URL 的映射（本地模式恒为空，dataURL 直接可显）
export async function loadProducts() {
  if (!cloudMode) return { list: localList(), urls: {} }
  const r = await post('listDrafts')
  if (!r.ok) throw new Error(r.error || 'LOAD_FAIL')
  return { list: r.list, urls: r.urls || {} }
}

export async function saveProduct(product) {
  if (!cloudMode) {
    const list = localList()
    const i = list.findIndex((p) => p.id === product.id)
    if (i >= 0) list[i] = product
    else list.unshift(product)
    localSave(list)
    return true
  }
  const r = await post('saveDraft', { product })
  return !!r.ok
}

export async function deleteProduct(id) {
  if (!cloudMode) {
    localSave(localList().filter((p) => p.id !== id))
    return true
  }
  const r = await post('deleteDraft', { id })
  return !!r.ok
}

// ---------- 图片 ----------

// 压缩重绘：本地模式压小（≤480，省 localStorage）；云模式保细节（≤1280）再上传
function resize(file, max, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/jpeg', quality))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片读取失败'))
    }
    img.src = url
  })
}

// 返回 { ref, url }：ref 入库（云模式为 fileID，本地为 dataURL），url 用于立即展示。
// HTTP 访问服务请求体上限约 100KB（调试日志 F）：小图单发，大图切 ~80K 字符分片逐个发、
// 云端拼回后入云存储。
const CHUNK = 80_000

export async function uploadImage(file, pid) {
  if (!cloudMode) {
    const dataURL = await resize(file, 480, 0.82)
    return { ref: dataURL, url: dataURL }
  }
  const dataURL = await resize(file, 1280, 0.85)
  const b64 = dataURL.split(',')[1]

  let r
  if (b64.length <= CHUNK) {
    r = await post('uploadImage', { b64, ext: 'jpg', pid })
  } else {
    const uploadId = 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    const total = Math.ceil(b64.length / CHUNK)
    for (let i = 0; i < total; i++) {
      const cr = await post('uploadChunk', {
        uploadId,
        seq: i,
        b64: b64.slice(i * CHUNK, (i + 1) * CHUNK),
      })
      if (!cr.ok) throw new Error(cr.error || `分片 ${i + 1}/${total} 上传失败`)
    }
    r = await post('uploadFinish', { uploadId, total, ext: 'jpg', pid })
  }
  if (!r.ok) throw new Error(r.error || 'UPLOAD_FAIL')
  return { ref: r.fileID, url: r.url }
}

// ---------- 课程草稿（步骤④ 视频编排；仅云模式） ----------

export async function getCourseDraft(courseId) {
  const r = await post('getCourseDraft', { courseId })
  if (!r.ok) throw new Error(r.error || 'LOAD_COURSE_FAIL')
  return r.course // null = 还没有草稿
}

export async function saveCourseDraft(course) {
  const r = await post('saveCourseDraft', { course })
  return !!r.ok
}

export async function publishCourse(courseId) {
  const r = await post('publishCourse', { courseId })
  if (!r.ok) throw new Error(r.error || 'PUBLISH_FAIL')
  return true
}

// ---------- 视频上传 ----------

function putWithProgress(url, headers, body, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v)
    if (xhr.upload) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total)
      }
    }
    xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error('直传失败 HTTP ' + xhr.status)))
    xhr.onerror = () => reject(new Error('直传网络错误'))
    xhr.send(body)
  })
}

function fileToB64(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result).split(',')[1])
    fr.onerror = () => reject(new Error('文件读取失败'))
    fr.readAsDataURL(file)
  })
}

// 上传分段视频（≤10MB 约定）。主路径：云端签凭证 → 浏览器 PUT 直传云存储（秒级）；
// 凭证不可用时自动回落分片通道（~80KB/片，10MB 约 1 分钟）。返回 { ref }（fileID）。
export async function uploadVideo(file, courseId, segName, onProgress) {
  if (!cloudMode) throw new Error('视频上传需云端模式（配置 VITE_ADMIN_API）')
  if (file.size > 15 * 1024 * 1024) throw new Error('单个视频请控制在 10MB 左右（当前超过 15MB）')
  const ext = /\.mov$/i.test(file.name) ? 'mov' : 'mp4'

  const meta = await post('getVideoUploadMeta', { courseId, name: segName, ext })
  if (meta.ok) {
    await putWithProgress(
      meta.url,
      {
        Authorization: meta.authorization,
        'x-cos-security-token': meta.token,
        'x-cos-meta-fileid': meta.cosFileId,
      },
      file,
      onProgress,
    )
    return { ref: meta.fileId }
  }

  // 回落：分片 base64（与图片同通道，kind=video 落 videos/ 前缀）
  const b64 = await fileToB64(file)
  const uploadId = 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  const total = Math.ceil(b64.length / CHUNK)
  for (let i = 0; i < total; i++) {
    const cr = await post('uploadChunk', {
      uploadId,
      seq: i,
      b64: b64.slice(i * CHUNK, (i + 1) * CHUNK),
    })
    if (!cr.ok) throw new Error(cr.error || `分片 ${i + 1}/${total} 上传失败`)
    if (onProgress) onProgress((i + 1) / total)
  }
  const r = await post('uploadFinish', { uploadId, total, ext, pid: courseId, kind: 'video' })
  if (!r.ok) throw new Error(r.error || 'UPLOAD_FAIL')
  return { ref: r.fileID }
}

// 上架小程序：商品草稿发布到 products（首页/详情即刻可见）
export async function publishProduct(id) {
  const r = await post('publishProduct', { id })
  if (!r.ok) {
    const msg =
      { NEED_COVER: '请先在第 1 步上传封面图', NEED_INFO: '请先在第 2 步填好名称和价格', NEED_SKUS: '请先在第 3 步配置规格' }[
        r.error
      ] || r.error || '上架失败'
    throw new Error(msg)
  }
  return true
}

// ---------- 小程序橱窗（规格 §八：排序 + 上下架） ----------

export async function listShowcase() {
  const r = await post('listShowcase')
  if (!r.ok) throw new Error(r.error || 'LOAD_SHOWCASE_FAIL')
  return { list: r.list, urls: r.urls || {} }
}

export async function saveShowcase(items) {
  const r = await post('saveShowcase', { items })
  return !!r.ok
}

// ---------- 二维码卡片 + 码批次（步骤⑤⑥） ----------

export async function getCard(productId) {
  const r = await post('getCard', { productId })
  if (!r.ok) throw new Error(r.error || 'LOAD_CARD_FAIL')
  return { card: r.card, artUrl: r.artUrl }
}

export async function saveCard(card) {
  const r = await post('saveCard', { card })
  return !!r.ok
}

export async function listBatches(courseId) {
  const r = await post('listBatches', { courseId })
  if (!r.ok) throw new Error(r.error || 'LOAD_BATCH_FAIL')
  return r.list
}

export async function createBatch(courseId, count) {
  const r = await post('createBatch', { courseId, count })
  if (!r.ok) throw new Error(r.error || 'GEN_FAIL')
  return r // { batchId, codes }
}

export async function listBatchCodes(batchId) {
  const r = await post('listBatchCodes', { batchId })
  if (!r.ok) throw new Error(r.error || 'LOAD_CODES_FAIL')
  return r.codes
}

export async function getSettings() {
  const r = await post('getSettings')
  return r.settings || {}
}

export async function saveSettings(settings) {
  const r = await post('saveSettings', settings)
  return !!r.ok
}

// ---------- 首页内容（橱窗逐块接入：hero 文案 / 信任条 / FAQ） ----------

export async function getHomeContent() {
  const r = await post('getHomeContent')
  if (!r.ok) throw new Error(r.error || 'LOAD_CONTENT_FAIL')
  return r.home // null = 还没编辑过（小程序用默认文案）
}

export async function saveHomeContent(home) {
  const r = await post('saveHomeContent', { home })
  return !!r.ok
}

// ---------- 数据看板 ----------

export async function getDashboard() {
  const r = await post('getDashboard')
  if (!r.ok) throw new Error(r.error || 'LOAD_DASHBOARD_FAIL')
  return r
}

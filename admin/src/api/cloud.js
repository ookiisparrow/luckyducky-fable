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

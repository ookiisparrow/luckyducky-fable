/**
 * 云适配层（与小程序 utils/cloud.js 同思路：业务代码不直接碰后端 SDK，换后端只改这里）。
 *
 * 当前为「本地模式」：数据存 localStorage、图片压成小尺寸 dataURL——
 * 用于流水线交互的本机验收（验收单 J）。
 * 下一个 PR 接 CloudBase Web SDK（@cloudbase/js-sdk）：
 *   - login → 用户名密码登录（控制台建管理员账号）
 *   - loadProducts / saveProduct → 云函数（云端二次校验管理员身份）
 *   - uploadImage → 云存储（fileID 与小程序共用）
 * 规格：docs/设计规格-管理控制台.md §三/§七。
 */

const AUTH_KEY = 'ld_admin_auth'
const DATA_KEY = 'ld_admin_products'

export function isLoggedIn() {
  return !!localStorage.getItem(AUTH_KEY)
}

// 本地模式：任意非空账号密码均可进入（云接线后换真实登录）
export async function login(username, password) {
  if (!username || !password) return { ok: false, error: '请输入账号与密码' }
  localStorage.setItem(AUTH_KEY, JSON.stringify({ username, at: Date.now() }))
  return { ok: true }
}

export function logout() {
  localStorage.removeItem(AUTH_KEY)
}

export function currentUser() {
  try {
    return JSON.parse(localStorage.getItem(AUTH_KEY))?.username || ''
  } catch {
    return ''
  }
}

export async function loadProducts() {
  try {
    const list = JSON.parse(localStorage.getItem(DATA_KEY))
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

export async function saveProducts(list) {
  try {
    localStorage.setItem(DATA_KEY, JSON.stringify(list))
    return true
  } catch (e) {
    console.warn('saveProducts 失败（本地存储可能已满）', e)
    return false
  }
}

// 本地模式图片「上传」：压到 ≤480px 的 JPEG dataURL（够缩略预览，不撑爆 localStorage）。
// 云接线后改为云存储 uploadFile → 返回 fileID。
export function uploadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const max = 480
      const scale = Math.min(1, max / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/jpeg', 0.82))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片读取失败'))
    }
    img.src = url
  })
}

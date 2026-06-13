/**
 * 课程激活接口（P3 二维码激活闭环）。激活 / 确认是敏感、法律相关动作，一律走云函数。
 *
 * T1 砍多端：原 H5/App「演示模式」（视为已激活、本地假成功）已删——激活不做本地假成功。
 * 无云/异常：activate/confirm 返回 NETWORK 错误由页面提示；getMyCourses 返回空（宁锁勿漏）。
 */
import { callCloud } from '@/utils/cloud.js'
import { logger } from '@/utils/logger.js'

// 从页面启动参数解析激活码，三种进入方式（决策记录 §13：印刷走普通链接二维码，一码一地址）：
// ① 直连参数 ?code=（编译模式 / 体验版启动参数）
// ② 小程序码 scene（urlencode 的 'code=XXX' / 裸码，保留兼容）
// ③ 普通链接二维码：微信扫 https://<域名>/q/<码> 进小程序，完整链接在 ?q=（urlencode）；
//    取 code= 查询参数或路径最后一段
export function parseActivationCode(o) {
  if (!o) return ''
  if (o.code) return String(o.code).trim()
  if (o.scene) {
    const s = decodeURIComponent(o.scene)
    const m = s.match(/code=([A-Za-z0-9]+)/)
    if (m) return m[1]
    if (/^[A-Za-z0-9]{8,}$/.test(s)) return s
  }
  if (o.q) {
    const url = decodeURIComponent(o.q)
    const m = url.match(/[?&]code=([A-Za-z0-9]+)/) || url.match(/\/([A-Za-z0-9]+)(?:[?#].*)?$/)
    if (m) return m[1]
  }
  return ''
}

export async function activateCourse(code) {
  try {
    const res = await callCloud('activateCourse', { code })
    if (res) return res // { ok, state:'activated'|'mine', courseId } | { ok:false, error }
  } catch (e) {
    logger.warn('activation', 'activateCourse 云端异常', e)
  }
  return { ok: false, error: 'NETWORK' }
}

export async function confirmEnter(code) {
  try {
    const res = await callCloud('confirmEnter', { code })
    if (res) return res // { ok, enteredAt, revoked } | { ok:false, error }
  } catch (e) {
    logger.warn('activation', 'confirmEnter 云端异常', e)
  }
  return { ok: false, error: 'NETWORK' }
}

export async function getMyCourses() {
  try {
    const res = await callCloud('getMyCourses')
    if (res) return res.ok && Array.isArray(res.list) ? res.list : []
  } catch (e) {
    logger.warn('activation', 'getMyCourses 云端失败，按未解锁处理', e)
  }
  return []
}

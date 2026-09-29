// 「我」页继续学习卡的本地旧卡（冷启首帧先画·后台再刷）：我页读写；退出登录 / 删除个人资料时清掉。
import { type ContinueTarget } from './continueResolve'
import { readStorage } from '../utils/storage'

const CONT_KEY = 'ld:me-cont'

function sanitizeCont(raw: unknown): ContinueTarget | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const courseId = String(o.courseId || '')
  const lessonId = String(o.lessonId || '')
  if (!courseId || !lessonId) return null
  return {
    courseId,
    courseTitle: String(o.courseTitle || ''),
    lessonId,
    lessonName: String(o.lessonName || ''),
    segmentId: String(o.segmentId || ''),
    resumeAt: Math.floor(Number(o.resumeAt) || 0),
  }
}

export function readStoredCont(): ContinueTarget | null {
  return sanitizeCont(readStorage(CONT_KEY))
}

export function writeStoredCont(cont: ContinueTarget | null): void {
  try {
    if (cont) wx.setStorageSync(CONT_KEY, cont)
    else wx.removeStorageSync(CONT_KEY)
  } catch {
    /* 旧卡是加分项·存不上不影响本趟刷新 */
  }
}

/**
 * 课程相关接口。
 *
 * getCourses：小程序端走云函数 getCourses；H5 / App 端回退本地 data/course.js。
 *   返回 canonical 形状 [{ id, title, sort, chapters:[{ id, title, lessons:[{ id, name, dur, segments }] }] }]，
 *   与 tests/course.test.js 锁的三层契约一致。
 *   页面不直接调这里，统一经 store/courses.js 收口。
 */
import { callCloud } from '@/utils/cloud.js'
import { COURSES } from '@/data/course.js'
import { logger } from '@/utils/logger.js'

// 云端返回的轻量边界校验：课有 id / chapters 数组才算可用，否则整批回退本地
function isValidList(list) {
  return (
    Array.isArray(list) && list.length > 0 && list.every((c) => c && c.id && Array.isArray(c.chapters))
  )
}

export async function getCourses() {
  try {
    const res = await callCloud('getCourses')
    if (isValidList(res?.list)) return res.list
  } catch (e) {
    logger.warn('course', 'getCourses 云端失败，回退本地', e)
  }
  return COURSES
}

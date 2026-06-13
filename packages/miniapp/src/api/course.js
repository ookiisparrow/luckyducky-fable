/**
 * 课程相关接口。
 *
 * getCourses：走云函数 getCourses，返回 canonical 三层形状
 *   [{ id, title, sort, chapters:[{ id, title, lessons:[{ id, name, dur, segments }] }] }]，
 *   与 tests/course.test.js 锁的三层契约一致。页面不直接调这里，经 store/courses.js 收口。
 *
 * T1 砍多端：原 H5/App 本地回退（返回 data/course）已删；无云/无效返回空列表，store 走安全空形状。
 */
import { callCloud } from '@/utils/cloud.js'
import { logger } from '@/utils/logger.js'

// 云端返回的轻量边界校验：课有 id / chapters 数组才算可用
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
    logger.warn('course', 'getCourses 云端失败', e)
  }
  return []
}

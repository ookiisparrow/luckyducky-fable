import { describe, it, expect } from 'vitest'
import { resolveMyCourses } from '@/pkg-video/courses/myCourses.js'

// 「我的课程」列表 = 用户已激活课程（act.mine）→ 去重 + 取课程对象。
// 「全部教程」指向这个列表（非某单门课的课时·根因#8 多课）；同一门课多张激活码会在 mine 里重复，须去重。
const duck = { id: 'course-duck', title: '小鸭' }
const bear = { id: 'course-bear', title: '小熊' }
const getById = (id) => [duck, bear].find((c) => c.id === id) || null

describe('resolveMyCourses 我的课程列表', () => {
  it('按 mine 取课程对象，保序', () => {
    const r = resolveMyCourses([{ courseId: 'course-duck' }, { courseId: 'course-bear' }], getById)
    expect(r.map((c) => c.id)).toEqual(['course-duck', 'course-bear'])
  })
  it('同课多码 → 去重（只出一次）', () => {
    const r = resolveMyCourses(
      [{ courseId: 'course-bear' }, { courseId: 'course-bear' }, { courseId: 'course-duck' }],
      getById,
    )
    expect(r.map((c) => c.id)).toEqual(['course-bear', 'course-duck'])
  })
  it('课程查不到 / 空 courseId → 跳过', () => {
    const r = resolveMyCourses([{ courseId: 'ghost' }, {}, { courseId: 'course-duck' }], getById)
    expect(r.map((c) => c.id)).toEqual(['course-duck'])
  })
  it('空 / 非数组 → []', () => {
    expect(resolveMyCourses([], getById)).toEqual([])
    expect(resolveMyCourses(null, getById)).toEqual([])
  })
})

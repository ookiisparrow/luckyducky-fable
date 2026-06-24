import { describe, it, expect } from 'vitest'
import { resolveContinue } from '@/pages/me/continueResolve.js'

// 「我」页「继续学习」定位课程/课时：必须按观看记录自己的 courseId（或用户已解锁的课）取，
// 绝不回退到 courses.current（默认 list[0]=演示鸭课）—— bug：进小程序显演示课、点进演示列表，
// 退出再进才变小熊（根因#8 同 bug W：多课下用了默认课）。本纯函数锁正确定位。
const duck = { id: 'course-duck', chapters: [{ id: 'c1', lessons: [{ id: 'l1', name: '鸭1' }, { id: 'l2', name: '鸭2' }] }] }
const bear = { id: 'course-bear', chapters: [{ id: 'b1', lessons: [{ id: 'lb1', name: '熊1' }, { id: 'lb2', name: '熊2' }] }] }
const getById = (id) => [duck, bear].find((c) => c.id === id) || null

describe('resolveContinue 继续学习定位', () => {
  it('有最近观看 → 取记录自己的 courseId 那门课、定位该课时（不被默认课影响）', () => {
    const r = resolveContinue({ courseId: 'course-bear', lessonId: 'lb2', at: 5, dur: 10 }, getById, [
      { courseId: 'course-bear' },
    ])
    expect(r.course.id).toBe('course-bear')
    expect(r.index).toBe(1)
    expect(r.lessons[r.index].id).toBe('lb2')
  })

  it('无最近观看但有已解锁课 → 该课第一课时（开始学·非演示）', () => {
    const r = resolveContinue(null, getById, [{ courseId: 'course-bear' }])
    expect(r.course.id).toBe('course-bear')
    expect(r.index).toBe(0)
  })

  it('多门已解锁 → 取最近解锁的那门（mine 末项）', () => {
    const r = resolveContinue(null, getById, [{ courseId: 'course-duck' }, { courseId: 'course-bear' }])
    expect(r.course.id).toBe('course-bear')
  })

  it('记录的课时在该课里找不到 → 退回该课第一课时（不串到别的课/演示）', () => {
    const r = resolveContinue({ courseId: 'course-bear', lessonId: 'nope', at: 1, dur: 2 }, getById, [])
    expect(r.course.id).toBe('course-bear')
    expect(r.index).toBe(0)
  })

  it('无记录无解锁课 / 课程查不到 → null（卡片走兜底，不假装有课）', () => {
    expect(resolveContinue(null, getById, [])).toBeNull()
    expect(resolveContinue(null, getById, null)).toBeNull()
    expect(resolveContinue({ courseId: 'ghost', lessonId: 'x' }, getById, [])).toBeNull()
  })
})

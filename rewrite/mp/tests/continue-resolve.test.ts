// 黄金 learning-content §四「继续学习定位」（守卫 rw-mp-me-golden）：
// 按观看记录定位·绝不回退默认课；无记录取最近解锁课第一课时；脏课时退回第一课时；无课回空不假装。
import { describe, it, expect } from 'vitest'
import { continueResolve } from '../lib/continueResolve'

const COURSES = [
  { id: 'c1', title: '小棉鸭', chapters: [{ id: 'ch1', lessons: [{ id: 'l1', name: '起针', segments: [] }, { id: 'l2', name: '加针', segments: [] }] }] },
  { id: 'c2', title: '小熊', chapters: [{ id: 'ch1', lessons: [{ id: 'x1', name: '开头', segments: [] }] }] },
]

describe('继续学习定位（黄金 §四）', () => {
  it('大白话：有观看记录 → 定位那门课那个课时；记录里的课时已不在该课 → 退回该课第一课时（不串课）', () => {
    const hit = continueResolve([{ courseId: 'c1', last: { lessonId: 'l2' }, updatedAt: 200 }], [], COURSES)!
    expect(hit).toMatchObject({ courseId: 'c1', lessonId: 'l2', lessonName: '加针' })
    const stale = continueResolve([{ courseId: 'c1', last: { lessonId: 'ghost' }, updatedAt: 200 }], [], COURSES)!
    expect(stale).toMatchObject({ courseId: 'c1', lessonId: 'l1' }) // 脏课时退回第一课时·仍是本课
  })

  it('大白话：多条记录取最近的；记录指向查不到的课就看下一条，不假装', () => {
    const r = continueResolve(
      [
        { courseId: 'c2', last: { lessonId: 'x1' }, updatedAt: 100 },
        { courseId: 'c-deleted', last: { lessonId: 'l1' }, updatedAt: 300 }, // 最近但课已删
      ],
      [],
      COURSES
    )!
    expect(r.courseId).toBe('c2') // 跳过已删课·取下一条真实记录
  })

  it('大白话：没看过但解锁过 → 最近解锁那门的第一课时（开始学而非演示）；啥都没有 → 空（卡片走兜底不假装有课）', () => {
    const fresh = continueResolve([], [{ courseId: 'c2', enteredAt: 100 }, { courseId: 'c1', enteredAt: 900 }], COURSES)!
    expect(fresh).toMatchObject({ courseId: 'c1', lessonId: 'l1' }) // 最近解锁的 c1
    expect(continueResolve([], [], COURSES)).toBeNull()
    expect(continueResolve([], [{ courseId: 'c-deleted', enteredAt: 1 }], COURSES)).toBeNull() // 课查不到不假装
    expect(continueResolve(undefined, undefined, undefined)).toBeNull() // 脏入参安全
  })
})

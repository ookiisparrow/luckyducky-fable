import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { activateCourse, getMyCourses } from '@/api/activation.js'
import { useActivationStore } from '@/store/activation.js'
import { COURSES } from '@/data/course.js'

beforeEach(() => setActivePinia(createPinia()))

// 测试环境无 wx.cloud → api 走 H5/App 演示模式回退（规格 §四-4）
describe('activation api 演示模式回退', () => {
  it('activateCourse 回退为激活成功 + 本地课程', async () => {
    const res = await activateCourse('ANYCODE')
    expect(res).toMatchObject({ ok: true, state: 'activated', courseId: COURSES[0].id })
  })

  it('getMyCourses 回退为全部课程已解锁', async () => {
    const list = await getMyCourses()
    expect(list.map((m) => m.courseId)).toEqual(COURSES.map((c) => c.id))
    for (const m of list) expect(m.enteredAt).toBeTruthy()
  })
})

describe('activation store', () => {
  it('loadMine 后 unlocked 按 courseId 判定', async () => {
    const s = useActivationStore()
    expect(s.unlocked('course-duck')).toBe(false) // load 前锁态（宁锁勿漏）
    await s.loadMine()
    expect(s.unlocked('course-duck')).toBe(true)
    expect(s.unlocked('course-nope')).toBe(false)
  })

  it('confirm 成功后本地同步解锁，不必强刷', async () => {
    const s = useActivationStore()
    const res = await s.confirm('CODE', 'course-x')
    expect(res.ok).toBe(true)
    expect(s.unlocked('course-x')).toBe(true)
  })
})

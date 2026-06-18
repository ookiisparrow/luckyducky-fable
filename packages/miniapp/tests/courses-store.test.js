import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { COURSES, COURSE, ALL_LESSONS } from '@/data/course.js'

// T1 砍多端：getCourses 只对接云。测试 mock callCloud 返回云端课程（用 data/course 样例作云响应素材）。
const { callCloud } = vi.hoisted(() => ({ callCloud: vi.fn() }))
vi.mock('@/utils/cloud.js', () => ({ callCloud, initCloud: vi.fn(), uploadCloudFile: vi.fn() }))

import { useCoursesStore } from '@/store/courses.js'
import { getCourses } from '@/api/course.js'

beforeEach(() => {
  setActivePinia(createPinia())
  callCloud.mockImplementation(async (name) => (name === 'getCourses' ? { list: COURSES } : null))
})

describe('courses api / store（云路径，mock callCloud）', () => {
  it('api getCourses：透传云端课程列表', async () => {
    const list = await getCourses()
    expect(list).toEqual(COURSES)
  })

  it('load 前 getters 是安全空形状，页面不用判空', () => {
    const store = useCoursesStore()
    expect(store.current.chapters).toEqual([])
    expect(store.allLessons).toEqual([])
  })

  it('load 后 current / allLessons 与课程表一致（含 chapter 归属）', async () => {
    const store = useCoursesStore()
    await store.load()
    expect(store.current.id).toBe('course-duck')
    expect(store.allLessons.map((l) => l.id)).toEqual(ALL_LESSONS.map((l) => l.id))
    expect(store.allLessons[0].chapter).toBe(COURSE.chapters[0].id)
  })
})

// 多课程聚焦（根因#8：单课样本下 current=list[0] 恰对，真上第二门课才暴露——激活小熊跳目录仍显 list[0]＝小鸭）。
// 用 ≥2 门课的真实样本锁：current 必须随 currentId 走、不再恒 list[0]。
describe('courses store · 多课程聚焦 current 随激活课（根因#8）', () => {
  const TWO = [
    { id: 'course-duck', title: '幸运小鸭', chapters: [] },
    { id: 'course-bear', title: '幸运小熊', chapters: [] },
  ]
  beforeEach(() => {
    callCloud.mockImplementation(async (name) => (name === 'getCourses' ? { list: TWO } : null))
  })

  it('未指定 currentId → 回退第一门（保持原行为）', async () => {
    const store = useCoursesStore()
    await store.load()
    expect(store.current.id).toBe('course-duck')
  })

  it('setCurrent 指定小熊 → current 是小熊，不再是 list[0] 小鸭', async () => {
    const store = useCoursesStore()
    await store.load()
    store.setCurrent('course-bear')
    expect(store.current.id).toBe('course-bear') // ★ bug 核心：激活小熊就该看小熊
    expect(store.currentId).toBe('course-bear')
  })

  it('currentId 指向不存在的课 → 回退第一门（防脏 id 白屏）', async () => {
    const store = useCoursesStore()
    await store.load()
    store.setCurrent('course-ghost')
    expect(store.current.id).toBe('course-duck')
  })

  it('setCurrent("") 清空 → 回退第一门', async () => {
    const store = useCoursesStore()
    await store.load()
    store.setCurrent('course-bear')
    store.setCurrent('')
    expect(store.current.id).toBe('course-duck')
  })
})

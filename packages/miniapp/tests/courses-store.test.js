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

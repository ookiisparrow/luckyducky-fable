import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useCoursesStore } from '@/store/courses.js'
import { getCourses } from '@/api/course.js'
import { COURSES, COURSE, ALL_LESSONS } from '@/data/course.js'

// 不挂 persist 插件，纯测 store 逻辑（courses 本就不持久化）
beforeEach(() => setActivePinia(createPinia()))

describe('courses api / store', () => {
  it('api getCourses：无 wx.cloud（H5 / 测试环境）回退本地 COURSES', async () => {
    const list = await getCourses()
    expect(list).toEqual(COURSES)
  })

  it('load 前 getters 是安全空形状，页面不用判空', () => {
    const store = useCoursesStore()
    expect(store.current.chapters).toEqual([])
    expect(store.allLessons).toEqual([])
  })

  it('load 后 current / allLessons 与本地课程表一致（含 chapter 归属）', async () => {
    const store = useCoursesStore()
    await store.load()
    expect(store.current.id).toBe('course-duck')
    expect(store.allLessons.map((l) => l.id)).toEqual(ALL_LESSONS.map((l) => l.id))
    expect(store.allLessons[0].chapter).toBe(COURSE.chapters[0].id)
  })
})

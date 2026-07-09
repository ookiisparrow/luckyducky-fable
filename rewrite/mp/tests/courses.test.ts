// 课程目录会话缓存测试（镜像 lib/catalog.ts 商品缓存家风·根因账本#15）：miss 回填 / 命中零调用 /
// 失败不毁缓存(下次仍重试) / getCourseById 命中与 miss。cache 是模块级单例，每个 it 用 vi.resetModules()
// + 动态 import 拿一份全新模块实例，防跨用例互相沾状态。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { getCoursesMock } = vi.hoisted(() => ({ getCoursesMock: vi.fn() }))
vi.mock('../api/learning', () => ({ getCourses: getCoursesMock }))

const COURSES = [
  { id: 'c1', title: '钩织入门' },
  { id: 'c2', title: '刺绣基础' },
]

beforeEach(() => {
  vi.resetModules()
  getCoursesMock.mockReset()
})

describe('getAllCourses（miss 回填·命中零调用·失败不毁缓存）', () => {
  it('大白话：miss 时调一次 api 回填缓存；再拿一次数据命中缓存，不再新增调用（零冗余往返）', async () => {
    getCoursesMock.mockResolvedValue({ ok: true, list: COURSES })
    const { getAllCourses } = await import('../lib/courses')
    expect(await getAllCourses()).toEqual(COURSES)
    expect(getCoursesMock).toHaveBeenCalledTimes(1)
    expect(await getAllCourses()).toEqual(COURSES)
    expect(getCoursesMock).toHaveBeenCalledTimes(1) // 命中缓存·零新增调用
  })

  it('大白话：api 失败（ok:false 或 list 非数组）返回 null 且不留假缓存，下次调用照常重试直到成功', async () => {
    getCoursesMock.mockResolvedValueOnce({ ok: false })
    const { getAllCourses } = await import('../lib/courses')
    expect(await getAllCourses()).toBeNull()
    expect(getCoursesMock).toHaveBeenCalledTimes(1)
    getCoursesMock.mockResolvedValueOnce({ ok: true, list: '坏数据' })
    expect(await getAllCourses()).toBeNull() // list 非数组同样按失败处理，不崩
    expect(getCoursesMock).toHaveBeenCalledTimes(2) // 未被上次失败卡死在坏态·仍在重试
    getCoursesMock.mockResolvedValueOnce({ ok: true, list: COURSES })
    expect(await getAllCourses()).toEqual(COURSES) // 第三次终于成功·填入缓存
    expect(getCoursesMock).toHaveBeenCalledTimes(3)
  })
})

describe('getCourseById（复用 getAllCourses·命中与 miss）', () => {
  it('大白话：空 id 直接返回 null，不发请求', async () => {
    const { getCourseById } = await import('../lib/courses')
    expect(await getCourseById('')).toBeNull()
    expect(getCoursesMock).toHaveBeenCalledTimes(0)
  })

  it('大白话：按 id 命中返回该课程；查不到的 id 返回 null（不崩、不假装）；两次查询共享同一次回填缓存', async () => {
    getCoursesMock.mockResolvedValue({ ok: true, list: COURSES })
    const { getCourseById } = await import('../lib/courses')
    expect(await getCourseById('c2')).toEqual(COURSES[1])
    expect(await getCourseById('c-ghost')).toBeNull()
    expect(getCoursesMock).toHaveBeenCalledTimes(1)
  })
})

// @vitest-environment happy-dom
// Courses.vue syncVod：同步结论在随后的重载成功后仍可见；重载的是刚同步的那门课，与输入框当下写着什么无关。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const { getCourseDraftMock, syncVodMediaMock } = vi.hoisted(() => ({ getCourseDraftMock: vi.fn(), syncVodMediaMock: vi.fn() }))
vi.mock('../src/api/content', () => ({
  getCourseDraft: getCourseDraftMock,
  saveCourseDraft: vi.fn().mockResolvedValue({ ok: true }),
  publishCourse: vi.fn(),
  uploadVideo: vi.fn(),
  syncVodMedia: syncVodMediaMock,
}))
vi.mock('../src/api/products', () => ({ listDrafts: vi.fn().mockResolvedValue({ ok: true, list: [] }) }))
vi.mock('vue-router', () => ({
  useRoute: () => ({ query: { courseId: 'course-p1' } }),
  useRouter: () => ({ push: vi.fn() }),
  onBeforeRouteLeave: vi.fn(),
}))

import Courses from '../src/pages/Courses.vue'

const course = (id: string) => ({
  id,
  title: '课',
  rev: 1,
  chapters: [{ title: '章', lessons: [{ title: '课时', segments: [{ title: '段', videoFileId: '5285890812345678901', vodUrl: '' }] }] }],
})

beforeEach(() => {
  getCourseDraftMock.mockReset().mockImplementation(async (id: string) => ({ ok: true, course: course(id) }))
  syncVodMediaMock.mockReset().mockResolvedValue({ ok: true, ready: 0, processing: 1 })
})

async function clickSync(w: ReturnType<typeof mount>) {
  await w.findAll('button').find((b) => b.text().includes('同步转码状态'))!.trigger('click')
  await flushPromises()
}

describe('Courses.vue 同步转码结论不被重载抹掉', () => {
  it('大白话：同步成功、重载成功后，仍显示「仍在转码 1 段」', async () => {
    const w = mount(Courses, { props: { embed: true, wizardCourseId: 'course-p1' } })
    await flushPromises()
    await clickSync(w)
    expect(syncVodMediaMock).toHaveBeenCalledWith('course-p1')
    expect(w.find('.status').text()).toContain('仍在转码 1 段')
  })

  it('大白话：输入框清空后点同步，照样重载刚同步的课并显示结论', async () => {
    const w = mount(Courses)
    await flushPromises()
    await w.find('.cid-box input').setValue('')
    await clickSync(w)
    expect(getCourseDraftMock).toHaveBeenLastCalledWith('course-p1')
    expect(w.find('.status').text()).toContain('仍在转码 1 段')
  })

  it('大白话：输入框改成别的课但没载入，同步后重载的仍是刚同步的课，不把结论挂到别的课上', async () => {
    const w = mount(Courses)
    await flushPromises()
    await w.find('.cid-box input').setValue('course-p2')
    await clickSync(w)
    expect(getCourseDraftMock).toHaveBeenLastCalledWith('course-p1')
    expect(w.find('.status').text()).toContain('仍在转码 1 段')
  })

  it('大白话：同步成功但重载失败，显示重载失败原因而不是装成功', async () => {
    const w = mount(Courses, { props: { embed: true, wizardCourseId: 'course-p1' } })
    await flushPromises()
    getCourseDraftMock.mockResolvedValue({ ok: false, error: 'NETWORK:boom' })
    await clickSync(w)
    expect(w.find('.status').text()).not.toContain('仍在转码')
    expect(w.find('.status').text()).not.toBe('')
  })
})

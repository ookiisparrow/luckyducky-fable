// @vitest-environment happy-dom
// Courses.vue 无课号直入：商品桥读失败要把原因留在页面上，不能清掉提示装成「请手输课号」的空态。
import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const { listDraftsMock } = vi.hoisted(() => ({ listDraftsMock: vi.fn() }))
vi.mock('../src/api/content', () => ({
  getCourseDraft: vi.fn(),
  saveCourseDraft: vi.fn(),
  publishCourse: vi.fn(),
  uploadVideo: vi.fn(),
  syncVodMedia: vi.fn(),
}))
vi.mock('../src/api/products', () => ({ listDrafts: listDraftsMock }))
vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {} }),
  useRouter: () => ({ push: vi.fn() }),
  onBeforeRouteLeave: vi.fn(),
}))

import Courses from '../src/pages/Courses.vue'

describe('Courses.vue 课程选择列表读失败', () => {
  it('大白话：没带课号时商品列表读失败，提示留着，不装成手输课号的空态', async () => {
    listDraftsMock.mockResolvedValue({ ok: false, status: 0, error: 'NETWORK:boom' })
    const w = mount(Courses)
    await flushPromises()
    expect(w.find('.status').exists()).toBe(true)
    expect(w.find('.status').text()).toContain('网络不通')
    expect(w.text()).not.toContain('输入课程编号（course-xxx）载入其章节结构')
    w.unmount()
  })
})

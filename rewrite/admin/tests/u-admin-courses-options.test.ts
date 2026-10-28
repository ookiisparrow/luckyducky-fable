// @vitest-environment happy-dom
// Courses.vue 无课号直入：商品桥读失败要把原因留在页面上，不能清掉提示装成「请手输课号」的空态。
// 下拉在进页面时就发出、不会取消：人已经手输课号并且载入有了结果之后，晚到的下拉失败不能改状态行。
import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { pending } from './helpers/pending'

const { listDraftsMock, getCourseDraftMock } = vi.hoisted(() => ({
  listDraftsMock: vi.fn(),
  getCourseDraftMock: vi.fn(),
}))
vi.mock('../src/api/content', () => ({
  getCourseDraft: getCourseDraftMock,
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

const course = { id: 'course-p1', title: '小熊课', rev: 1, chapters: [] as unknown[] }

async function loadByHand(w: ReturnType<typeof mount>, id: string) {
  await w.find('.cid-box input').setValue(id)
  await w.findAll('button').find((b) => b.text().includes('载入'))!.trigger('click')
  await flushPromises()
}

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

  it('大白话：课已经载入成功后，晚到的课程下拉失败不把空状态盖成网络错误', async () => {
    const drafts = pending()
    listDraftsMock.mockReturnValue(drafts.p)
    getCourseDraftMock.mockResolvedValue({ ok: true, course })
    const w = mount(Courses)
    await flushPromises()
    await loadByHand(w, 'course-p1')
    expect((w.find('.title-in').element as HTMLInputElement).value).toBe('小熊课')
    expect(w.find('.status').exists()).toBe(false)
    drafts.release({ ok: false, status: 0, error: 'NETWORK:boom' })
    await flushPromises()
    expect(w.find('.status').exists()).toBe(false)
    expect(w.text()).not.toContain('网络不通')
    expect((w.find('.title-in').element as HTMLInputElement).value).toBe('小熊课')
    w.unmount()
  })

  it('大白话：手输课号打开失败时仍显示这句错误，晚到的下拉失败不改它', async () => {
    const drafts = pending()
    listDraftsMock.mockReturnValue(drafts.p)
    getCourseDraftMock.mockResolvedValue({ ok: false, error: 'DOC_READ_FAIL' })
    const w = mount(Courses)
    await flushPromises()
    await loadByHand(w, 'course-missing')
    const shown = w.find('.status').text()
    expect(shown).toContain('云端数据暂时读不出来')
    drafts.release({ ok: false, status: 0, error: 'NETWORK:boom' })
    await flushPromises()
    expect(w.find('.status').text()).toBe(shown)
    expect(w.find('.status').text()).not.toContain('网络不通')
    expect(w.find('.title-in').exists()).toBe(false)
    w.unmount()
  })
})

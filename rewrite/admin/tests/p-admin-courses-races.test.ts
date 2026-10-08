// @vitest-environment happy-dom
// Courses.vue：连点载入时旧回包不覆盖新课；单段传视频期间锁住切课/删段/离页，传完（成败都）解锁；
// 段在上传期间没了就如实说没关联上，不往不存在的段上写。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'

const api = vi.hoisted(() => ({
  getCourseDraft: vi.fn(),
  saveCourseDraft: vi.fn(),
  publishCourse: vi.fn(),
  uploadVideo: vi.fn(),
  syncVodMedia: vi.fn(),
}))
vi.mock('../src/api/content', () => api)
vi.mock('../src/api/products', () => ({ listDrafts: vi.fn().mockResolvedValue({ ok: true, list: [] }) }))
vi.mock('vue-router', () => ({
  useRoute: () => ({ query: { courseId: 'course-p1' } }),
  useRouter: () => ({ push: vi.fn() }),
  onBeforeRouteLeave: vi.fn(),
}))

import Courses from '../src/pages/Courses.vue'
import { isUploadLocked } from '../src/lib/uploadLock'
import { pending } from './helpers/pending'

const course = (id: string, title: string) => ({
  id,
  title,
  rev: 1,
  chapters: [{ title: '章', lessons: [{ name: '课时', segments: [{ name: '段一', dur: '01:00', videoFileId: '' }] }] }],
})

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset()
  api.getCourseDraft.mockImplementation(async (id: string) => ({ ok: true, course: course(id, '课一') }))
  api.saveCourseDraft.mockResolvedValue({ ok: true, rev: 2 })
})

const btn = (w: VueWrapper<any>, text: string) => w.findAll('button').find((b) => b.text() === text)!
const pickVideo = async (w: VueWrapper<any>) => {
  const input = w.find('.seg input[type="file"]')
  Object.defineProperty(input.element, 'files', { value: [new File(['x'], 'a.mp4', { type: 'video/mp4' })], configurable: true })
  await input.trigger('change')
  await flushPromises()
}

describe('Courses.vue 载入乱序', () => {
  it('大白话：先发的载入后回包，不把编辑器换回旧课', async () => {
    const old = pending()
    api.getCourseDraft.mockReturnValueOnce(old.p).mockResolvedValueOnce({ ok: true, course: course('course-p2', '课二') })
    const w = mount(Courses)
    await w.find('.cid-box input').setValue('course-p2')
    await btn(w, '载入').trigger('click')
    await flushPromises()
    old.release({ ok: true, course: course('course-p1', '课一') })
    await flushPromises()
    expect((w.find('.title-in').element as HTMLInputElement).value).toBe('课二')
  })
})

describe('Courses.vue 单段传视频', () => {
  it('大白话：上传期间切课/删段/离页全锁；传成功后写回该段、解锁', async () => {
    const up = pending()
    api.uploadVideo.mockReturnValueOnce(up.p)
    const w = mount(Courses)
    await flushPromises()
    await pickVideo(w)
    expect(api.uploadVideo).toHaveBeenCalledWith('course-p1', '段一', expect.any(File), expect.any(Function), { allowVod: true })
    expect(isUploadLocked()).toBe(true)
    expect(btn(w, '载入').attributes('disabled')).toBeDefined()
    expect(w.find('.cid-box input').attributes('disabled')).toBeDefined()
    expect(w.find('.seg button[title="删段"]').attributes('disabled')).toBeDefined()

    up.release({ ok: true, fileId: 'cloud://v1' })
    await flushPromises()
    expect(w.find('.seg .upload').text()).toBe('已传 · 替换')
    expect(isUploadLocked()).toBe(false)
    expect(btn(w, '载入').attributes('disabled')).toBeUndefined()
    expect(w.find('.seg button[title="删段"]').attributes('disabled')).toBeUndefined()
  })

  it('大白话：上传失败也解锁，并显示失败原因', async () => {
    api.uploadVideo.mockResolvedValueOnce({ ok: false, status: 500, error: 'NETWORK:boom' })
    const w = mount(Courses)
    await flushPromises()
    await pickVideo(w)
    expect(isUploadLocked()).toBe(false)
    expect(btn(w, '载入').attributes('disabled')).toBeUndefined()
    expect(w.find('.status').text()).not.toBe('')
    expect(w.find('.seg .upload').text()).toBe('选视频')
  })

  it('大白话：上传期间这段已从课时里没了——提示没关联上，不当成功', async () => {
    const up = pending()
    api.uploadVideo.mockReturnValueOnce(up.p)
    const w = mount(Courses)
    await flushPromises()
    await pickVideo(w)
    // 界面上删段已被锁，这里直接改页面数据模拟结构被别的路径改掉
    ;(w.vm as any).course.chapters[0].lessons[0].segments.splice(0, 1)
    up.release({ ok: true, fileId: 'cloud://v1' })
    await flushPromises()
    expect(w.find('.status').text()).toBe('这段已被移除，上传未关联')
    expect(isUploadLocked()).toBe(false)
  })
})

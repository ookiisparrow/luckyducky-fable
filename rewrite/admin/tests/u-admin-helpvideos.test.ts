// @vitest-environment happy-dom
// HelpVideos.vue 载入与删除：载入失败绝不放开保存（空档整档覆盖会连带孤儿 GC 删光云端视频）；
// 冲突后停自动保存、重新载入恢复；旧视频没删净也按新版本号继续；手动保存只走同一条保存链；删主题要点两次。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { transportErrorText } from '../src/lib/mapSystem'

const api = vi.hoisted(() => ({ listHelpVideos: vi.fn(), saveHelpVideos: vi.fn(), uploadVideo: vi.fn() }))
vi.mock('../src/api/content', () => api)

import HelpVideos from '../src/pages/HelpVideos.vue'

const ok = { ok: true, rev: 3, items: [{ id: 't1', title: '起针', sub: '', desc: '', segments: [{ id: 's1', name: '段', dur: '', videoFileId: 'f1' }] }] }
let w: VueWrapper | undefined
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  api.listHelpVideos.mockReset().mockResolvedValue(ok)
  api.saveHelpVideos.mockReset().mockResolvedValue({ ok: true, rev: 4 })
})
afterEach(async () => {
  w?.unmount()
  w = undefined
  await flushPromises()
  vi.useRealTimers()
})

describe('HelpVideos.vue 载入', () => {
  it('大白话：载入失败显示原因；之后加主题、等防抖、点保存，都不发保存', async () => {
    api.listHelpVideos.mockResolvedValue({ ok: false, error: 'NETWORK:Failed to fetch' })
    w = mount(HelpVideos)
    await flushPromises()
    expect(w.find('.status').text()).toBe('加载失败：' + transportErrorText('NETWORK:Failed to fetch'))
    await w.find('.add-topic').trigger('click')
    await vi.advanceTimersByTimeAsync(1000)
    await w.findAll('button').find((b) => b.text() === '保存全部')!.trigger('click')
    await flushPromises()
    expect(api.saveHelpVideos).not.toHaveBeenCalled()
    expect(w.find('.status').text()).toContain('内容未成功载入')
  })

  it('大白话：载入成功后编辑，防抖到点按拉取时的版本号保存一次', async () => {
    w = mount(HelpVideos)
    await flushPromises()
    await w.find('.t-title').setValue('起针总松')
    await vi.advanceTimersByTimeAsync(900)
    await flushPromises()
    expect(api.saveHelpVideos).toHaveBeenCalledTimes(1)
    expect(api.saveHelpVideos.mock.calls[0][1]).toBe(3)
    expect(w.find('.status').exists()).toBe(false)
  })

  it('大白话：保存撞冲突后点「重新载入」，冲突解除、新版本号生效、提示清掉', async () => {
    api.saveHelpVideos.mockResolvedValueOnce({ ok: false, error: 'DRAFT_CONFLICT' })
    w = mount(HelpVideos)
    await flushPromises()
    await w.find('.t-title').setValue('改一下')
    await vi.advanceTimersByTimeAsync(900)
    await flushPromises()
    expect(w.find('.status').text()).toContain('内容已被别处修改')
    api.listHelpVideos.mockResolvedValue({ ...ok, rev: 9 })
    await w.findAll('.status button').find((b) => b.text() === '重新载入')!.trigger('click')
    await flushPromises()
    expect(w.find('.status').exists()).toBe(false)
    await w.find('.t-title').setValue('再改')
    await vi.advanceTimersByTimeAsync(900)
    await flushPromises()
    expect(api.saveHelpVideos).toHaveBeenCalledTimes(2)
    expect(api.saveHelpVideos.mock.calls[1][1]).toBe(9)
  })

  it('大白话：删主题第一次只武装，第二次才删', async () => {
    w = mount(HelpVideos)
    await flushPromises()
    const del = () => w!.find('button[title="删主题"], button[title="再点确认删除"]')
    await del().trigger('click')
    expect(w.findAll('.t-title')).toHaveLength(1)
    await del().trigger('click')
    expect(w.findAll('.t-title')).toHaveLength(0)
  })
})

describe('HelpVideos.vue 视频上传失败', () => {
  // 与 Courses 同一个 uploadVideo，文案同走 launchErrorText：业务码有中文映射就用，上传器自带的中文原样透传不再套壳
  it.each([
    ['META_UNAVAILABLE', '上传通道暂时不可用。请稍后重试。'],
    ['直传失败 HTTP 403', '直传失败 HTTP 403'],
  ])('大白话：上传回 %s，提示「%s」', async (error, text) => {
    api.listHelpVideos.mockResolvedValue({ ...ok, items: [{ ...ok.items[0], segments: [{ id: 's1', name: '段', dur: '1:00', videoFileId: '' }] }] })
    api.uploadVideo.mockReset().mockResolvedValue({ ok: false, error })
    w = mount(HelpVideos)
    await flushPromises()
    const input = w.find('input[type="file"]')
    Object.defineProperty(input.element, 'files', { value: [new File(['x'], 'a.mp4', { type: 'video/mp4' })] })
    await input.trigger('change')
    await flushPromises()
    expect(api.uploadVideo).toHaveBeenCalledTimes(1)
    expect(w.find('.status').text()).toBe(text)
  })
})

describe('HelpVideos.vue 保存链', () => {
  const edit = async (v: string) => {
    await w!.find('.t-title').setValue(v)
    await vi.advanceTimersByTimeAsync(900)
    await flushPromises()
  }

  it('大白话：撞冲突后继续编辑、再点保存，都不再发保存（不循环重试覆盖别处）', async () => {
    api.saveHelpVideos.mockResolvedValueOnce({ ok: false, error: 'DRAFT_CONFLICT', rev: 8 })
    w = mount(HelpVideos)
    await flushPromises()
    await edit('改一下')
    await edit('再改一下')
    await w.findAll('button').find((b) => b.text() === '保存全部')!.trigger('click')
    await flushPromises()
    expect(api.saveHelpVideos).toHaveBeenCalledTimes(1)
    expect(w.find('.status').text()).toContain('内容已被别处修改')
  })

  it('大白话：旧视频没删净（GC_DELETE_FAIL）也按回包的新版本号继续，下一次不撞自己造的冲突', async () => {
    api.saveHelpVideos.mockResolvedValueOnce({ ok: false, error: 'GC_DELETE_FAIL', rev: 5 })
    w = mount(HelpVideos)
    await flushPromises()
    await edit('改一下')
    await edit('再改一下')
    expect(api.saveHelpVideos.mock.calls.map((c) => c[1])).toEqual([3, 5])
  })

  it('大白话：防抖没到点就点「保存全部」——只发一次保存，成功提示已保存', async () => {
    w = mount(HelpVideos)
    await flushPromises()
    await w.find('.t-title').setValue('改一下')
    await w.findAll('button').find((b) => b.text() === '保存全部')!.trigger('click')
    await flushPromises()
    await vi.advanceTimersByTimeAsync(1000)
    await flushPromises()
    expect(api.saveHelpVideos).toHaveBeenCalledTimes(1)
    expect(api.saveHelpVideos.mock.calls[0][0][0].title).toBe('改一下')
    expect(w.find('.status').text()).toBe('已保存（无视频的小段会被云端剔除）')
  })

  it('大白话：「保存全部」失败提示重试', async () => {
    api.saveHelpVideos.mockResolvedValue({ ok: false, status: 500, error: 'X' })
    w = mount(HelpVideos)
    await flushPromises()
    await w.findAll('button').find((b) => b.text() === '保存全部')!.trigger('click')
    await flushPromises()
    expect(w.find('.status').text()).toBe('保存失败，请重试')
  })
})

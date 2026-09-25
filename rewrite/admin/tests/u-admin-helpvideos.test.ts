// @vitest-environment happy-dom
// HelpVideos.vue 载入与删除：载入失败绝不放开保存（空档整档覆盖会连带孤儿 GC 删光云端视频）；
// 冲突后重新载入恢复自动保存；删主题要点两次。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'

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
    api.listHelpVideos.mockResolvedValue({ ok: false, error: 'NETWORK_FAIL' })
    w = mount(HelpVideos)
    await flushPromises()
    expect(w.find('.status').text()).toContain('加载失败：NETWORK_FAIL')
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

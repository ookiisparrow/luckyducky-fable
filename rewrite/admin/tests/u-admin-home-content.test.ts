// @vitest-environment happy-dom
// 首页内容表单走首页专用的读写接口（回包字段 home），不能串到其余页签的 getPageContent/savePageContent；
// 载入失败时的拒存提示点明是首页配置。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import HomeContentForm from '../src/components/pagecontent/HomeContentForm.vue'
import { SAVE_OK_MESSAGE } from '../src/lib/mapPageContent'

const api = vi.hoisted(() => ({ getHomeContent: vi.fn(), saveHomeContent: vi.fn(), getPageContent: vi.fn(), savePageContent: vi.fn() }))
vi.mock('../src/api/content', () => api)
vi.mock('../src/api/products', () => ({ uploadImage: vi.fn() }))

let wrapper: VueWrapper | undefined
beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset()
  api.getHomeContent.mockResolvedValue({ ok: true, home: { hero: { title: '旧标题' } } })
  api.saveHomeContent.mockResolvedValue({ ok: true })
})
afterEach(async () => {
  wrapper?.unmount()
  wrapper = undefined
  await flushPromises()
})

describe('HomeContentForm 读写接口', () => {
  it('大白话：载入读 home 字段，保存只调 saveHomeContent 且带上编辑后的内容', async () => {
    wrapper = mount(HomeContentForm)
    await flushPromises()
    expect((wrapper.find('input').element as HTMLInputElement).value).toBe('旧标题')
    await wrapper.find('input').setValue('新标题')
    await wrapper.find('.pc-toolbar button').trigger('click')
    await flushPromises()
    expect(api.saveHomeContent).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(api.saveHomeContent.mock.calls[0][0])).toContain('新标题')
    expect(api.getPageContent).not.toHaveBeenCalled()
    expect(api.savePageContent).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain(SAVE_OK_MESSAGE)
  })

  it('大白话：载入失败后点保存，提示不能覆盖已有首页配置，且不发保存', async () => {
    api.getHomeContent.mockResolvedValue({ ok: false, error: 'NETWORK_FAIL' })
    wrapper = mount(HomeContentForm)
    await flushPromises()
    expect(wrapper.text()).toContain('加载失败：NETWORK_FAIL')
    await wrapper.find('.pc-toolbar button').trigger('click')
    expect(wrapper.text()).toContain('内容未成功载入，暂不能保存（避免覆盖已有首页配置·请刷新重试）')
    expect(api.saveHomeContent).not.toHaveBeenCalled()
  })
})

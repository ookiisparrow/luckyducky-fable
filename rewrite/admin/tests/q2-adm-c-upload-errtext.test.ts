// @vitest-environment happy-dom
// 首页内容与目录页签传图被拒时说人话（与商品封面同一套上新错误文案），不甩 BAD_IMAGE 这类英文码。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const api = vi.hoisted(() => ({ getHomeContent: vi.fn(), saveHomeContent: vi.fn(), getPageContent: vi.fn(), savePageContent: vi.fn(), uploadImage: vi.fn() }))
vi.mock('../src/api/content', () => api)
vi.mock('../src/api/products', () => ({ uploadImage: api.uploadImage }))
vi.mock('../src/lib/compressImage', () => ({ compressImage: vi.fn().mockResolvedValue('b64') }))

import HomeContentForm from '../src/components/pagecontent/HomeContentForm.vue'
import CatalogPlayerTab from '../src/components/pagecontent/CatalogPlayerTab.vue'

beforeEach(() => {
  api.getHomeContent.mockReset().mockResolvedValue({ ok: true, home: {} })
  api.getPageContent.mockReset().mockResolvedValue({ ok: true, content: {} })
  api.uploadImage.mockReset().mockResolvedValue({ ok: false, status: 400, error: 'BAD_IMAGE' })
})

describe.each([
  ['首页内容', HomeContentForm],
  ['目录与播放', CatalogPlayerTab],
])('%s传图被拒', (_, component) => {
  it('大白话：提示换一张图，不甩英文码', async () => {
    const w = mount(component)
    await flushPromises()
    const input = w.find('input[type="file"]')
    Object.defineProperty(input.element, 'files', { value: [new File(['x'], 'a.jpg', { type: 'image/jpeg' })] })
    await input.trigger('change')
    await flushPromises()
    expect(api.uploadImage).toHaveBeenCalledTimes(1)
    expect(w.find('.ld-status').text()).toBe('图片太大或格式不对。请换一张再传。')
    w.unmount()
  })
})

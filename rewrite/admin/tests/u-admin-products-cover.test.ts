// @vitest-environment happy-dom
// Products.vue pickCover：取到文件后立即清空 input，封面压缩超限/上传失败后重选同一张图才会再触发 change。
import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'

vi.mock('../src/api/products', () => ({
  listDrafts: vi.fn().mockResolvedValue({
    ok: true,
    list: [{ id: 'p1', name: '材料包', price: '99', skus: [], images: [], params: [], detailSections: [], kit: [] }],
    urls: {},
    listed: {},
  }),
  saveDraft: vi.fn().mockResolvedValue({ ok: true }),
  deleteDraft: vi.fn(),
  uploadImage: vi.fn(),
  publishProduct: vi.fn(),
  unpublishProduct: vi.fn(),
  republishProduct: vi.fn(),
}))
vi.mock('../src/lib/compressImage', () => ({ compressImage: vi.fn().mockResolvedValue('') })) // 压缩超限

import Products from '../src/pages/Products.vue'

describe('Products.vue 封面选图后清空 input', () => {
  it('大白话：封面压缩超限提示后，input 已被清空，可以重选同一张图', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div/>' } }] })
    await router.push('/')
    await router.isReady()
    const w = mount(Products, { props: { embed: true, wizardProductId: 'p1', wizardSlice: 1 }, global: { plugins: [router] } })
    await flushPromises()
    const input = w.find('.cover-drop input[type="file"]')
    const el = input.element as HTMLInputElement
    const setValue = vi.fn()
    Object.defineProperty(el, 'files', { value: [new File(['x'], 'a.jpg', { type: 'image/jpeg' })] })
    Object.defineProperty(el, 'value', { get: () => 'C:\\fakepath\\a.jpg', set: setValue, configurable: true })
    await input.trigger('change')
    await flushPromises()
    expect(w.text()).toContain('图片压缩后仍超限')
    expect(setValue).toHaveBeenCalledWith('')
    w.unmount()
  })
})

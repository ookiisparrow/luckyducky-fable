// @vitest-environment happy-dom
// Cards.vue：加载失败才不出编辑器；上传被拒、定稿没存上、没图就定稿这类操作失败只在行内提示，编辑器留着，改了就能再试。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'

const api = vi.hoisted(() => ({ listDrafts: vi.fn(), getCard: vi.fn(), saveCard: vi.fn(), uploadImage: vi.fn() }))
vi.mock('../src/api/products', () => api)
vi.mock('../src/lib/compressImage', () => ({ compressImage: vi.fn().mockResolvedValue('b64') }))
vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }), useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }))

import Cards from '../src/pages/Cards.vue'

beforeEach(() => {
  api.listDrafts.mockReset().mockResolvedValue({ ok: true, list: [{ id: 'p1', name: '小熊' }], urls: {}, listed: {} })
  api.getCard.mockReset().mockResolvedValue({ ok: true, card: null, artUrl: '' })
  api.saveCard.mockReset().mockResolvedValue({ ok: true })
  api.uploadImage.mockReset()
})

const pick = async (w: VueWrapper<any>) => {
  const input = w.find('input[type="file"]')
  Object.defineProperty(input.element, 'files', { value: [new File(['x'], 'a.jpg', { type: 'image/jpeg' })], configurable: true })
  await input.trigger('change')
  await flushPromises()
}
const errLine = (w: VueWrapper<any>) => (w.find('.err-line').exists() ? w.find('.err-line').text() : '')

describe.each([
  ['独立页', {}, '.work'],
  ['上新向导第 5 步', { embed: true }, '.upload-only'],
])('%s 上传被拒', (_, props, editor) => {
  it('大白话：行内说换一张，编辑器还在；再传成功提示消失', async () => {
    const w = mount(Cards, { props: { wizardProductId: 'p1', ...props } })
    await flushPromises()
    api.uploadImage.mockResolvedValueOnce({ ok: false, status: 400, error: 'BAD_IMAGE' })
    await pick(w)
    expect(errLine(w)).toBe('图片太大或格式不对。请换一张再传。')
    expect(w.find(editor).exists()).toBe(true)
    api.uploadImage.mockResolvedValueOnce({ ok: true, fileID: 'cloud://a', url: 'https://u/a' })
    await pick(w)
    expect(errLine(w)).toBe('')
    w.unmount()
  })
})

describe('Cards.vue 定稿失败', () => {
  it('大白话：正面没图就点定稿——行内提示，编辑器还在', async () => {
    const w = mount(Cards, { props: { wizardProductId: 'p1' } })
    await flushPromises()
    await w.findAll('button').find((b) => b.text().includes('定稿并启用'))!.trigger('click')
    await flushPromises()
    expect(errLine(w)).toBe('正面还没有图案——取商品封面图或上传插画')
    expect(w.find('.work').exists()).toBe(true)
    w.unmount()
  })

  it('大白话：定稿没存上——行内提示重试，编辑器还在，再点能重试', async () => {
    api.getCard.mockResolvedValue({ ok: true, card: null, artUrl: '' })
    api.listDrafts.mockResolvedValue({ ok: true, list: [{ id: 'p1', name: '小熊', cover: 'cloud://c' }], urls: { 'cloud://c': 'https://u/c' }, listed: {} })
    api.saveCard.mockResolvedValueOnce({ ok: false, status: 0, error: 'CALL_TIMEOUT' })
    const w = mount(Cards, { props: { wizardProductId: 'p1' } })
    await flushPromises()
    const fin = () => w.findAll('button').find((b) => b.text().includes('定稿并启用'))!
    await fin().trigger('click')
    await flushPromises()
    expect(errLine(w)).toBe('定稿保存失败：请重试')
    expect(w.find('.work').exists()).toBe(true)
    await fin().trigger('click')
    await flushPromises()
    expect(errLine(w)).toBe('')
    expect(w.text()).toContain('已定稿')
    w.unmount()
  })

  it('大白话：向导里没封面还点「用商品封面图」——行内提示，上传区还在', async () => {
    const w = mount(Cards, { props: { wizardProductId: 'p1', embed: true } })
    await flushPromises()
    await w.find('button.source-tile').trigger('click')
    expect(errLine(w)).toBe('该商品还没有封面图（去第 1 步上传）')
    expect(w.find('.upload-only').exists()).toBe(true)
    w.unmount()
  })

  it('大白话：上传被拒后改用商品封面图——旧的失败提示收掉', async () => {
    api.listDrafts.mockResolvedValue({ ok: true, list: [{ id: 'p1', name: '小熊', cover: 'cloud://c' }], urls: { 'cloud://c': 'https://u/c' }, listed: {} })
    api.getCard.mockResolvedValue({ ok: true, card: { productId: 'p1', courseId: 'c', name: 'n', status: 'final', front: { art: 'cloud://old', bg: '#fff', showBrand: true }, back: { bg: '#fff', brandText: '', texts: { title: '', sub: '', scanHint: '', warning: '' } }, sizeMM: { w: 90, h: 54 } }, artUrl: '' })
    const w = mount(Cards, { props: { wizardProductId: 'p1', embed: true } })
    await flushPromises()
    api.uploadImage.mockResolvedValueOnce({ ok: false, status: 400, error: 'BAD_IMAGE' })
    await pick(w)
    expect(errLine(w)).not.toBe('')
    await w.find('button.source-tile').trigger('click')
    expect(errLine(w)).toBe('')
    w.unmount()
  })
})

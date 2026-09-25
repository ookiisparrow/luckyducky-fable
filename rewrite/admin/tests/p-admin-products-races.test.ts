// @vitest-environment happy-dom
// Products.vue 编辑器的跨目标竞态：保存/上传/关闭的回包晚到时，期间已切到另一件商品，
// 收尾效果（关编辑器、写封面、塞相册、失败提示）不许打到新商品上；「课程运维」写回 courseId 不能用旧快照盖掉未落盘编辑。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'

const api = vi.hoisted(() => ({
  listDrafts: vi.fn(),
  saveDraft: vi.fn(),
  deleteDraft: vi.fn(),
  uploadImage: vi.fn(),
  publishProduct: vi.fn(),
  unpublishProduct: vi.fn(),
  republishProduct: vi.fn(),
}))
vi.mock('../src/api/products', () => api)
vi.mock('../src/lib/compressImage', () => ({ compressImage: vi.fn().mockResolvedValue('b64') }))

import Products from '../src/pages/Products.vue'
import { compressImage } from '../src/lib/compressImage'

const draft = (id: string, name: string) => ({ id, name, price: '99', skus: [], images: [], params: [], detailSections: [], kit: [] })
let w: VueWrapper<any>
let router: ReturnType<typeof createRouter>

beforeEach(async () => {
  for (const f of Object.values(api)) f.mockReset()
  api.listDrafts.mockResolvedValue({ ok: true, list: [draft('p1', '小熊'), draft('p2', '小兔')], urls: {}, listed: {} })
  api.saveDraft.mockResolvedValue({ ok: true })
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div/>' } },
      { path: '/courses', component: { template: '<div/>' } },
    ],
  })
  await router.push('/')
  await router.isReady()
  w = mount(Products, { global: { plugins: [router] } })
  await flushPromises()
})
afterEach(async () => {
  w.unmount() // 清掉防抖计时器，别让上一条用例的补存串进下一条（保存队列是模块级共享的）
  await flushPromises()
})

const pending = () => {
  let release: (v: unknown) => void = () => {}
  const p = new Promise((r) => (release = r))
  return { p, release: (v: unknown) => release(v) }
}
const open = async (i: number) => {
  await w.findAll('button').filter((b) => b.text() === '编辑')[i].trigger('click')
  await flushPromises()
}
const editorId = () => (w.find('.editor .pid').exists() ? w.find('.editor .pid').text() : '')
const status = () => (w.find('.ld-status').exists() ? w.find('.ld-status').text() : '')
const typeName = (v: string) => w.find('.editor input[maxlength="60"]').setValue(v)
const btn = (text: string) => w.findAll('button').find((b) => b.text() === text)!
const pickFile = async (sel: string) => {
  const input = w.find(sel)
  Object.defineProperty(input.element, 'files', { value: [new File(['x'], 'a.jpg', { type: 'image/jpeg' })], configurable: true })
  await input.trigger('change')
  await flushPromises()
}

describe('Products.vue 课程运维写回 courseId', () => {
  it('大白话：编辑器正开着同一件商品——走保存队列，带上还没落盘的编辑，不用列表旧快照', async () => {
    await open(0)
    await typeName('小熊改名')
    await w.findAll('button[title="更多操作"]')[0].trigger('click')
    await btn('课程运维').trigger('click')
    await flushPromises()
    expect(api.saveDraft).toHaveBeenCalledTimes(1)
    expect(api.saveDraft.mock.calls[0][0]).toMatchObject({ id: 'p1', name: '小熊改名', courseId: 'course-p1' })
    expect(router.currentRoute.value.fullPath).toBe('/courses?courseId=course-p1')
  })

  it('大白话：编辑器没开这件商品——按列表档直接写回', async () => {
    await w.findAll('button[title="更多操作"]')[1].trigger('click')
    await btn('课程运维').trigger('click')
    await flushPromises()
    expect(api.saveDraft).toHaveBeenCalledWith({ ...draft('p2', '小兔'), courseId: 'course-p2' })
  })
})

describe('Products.vue 关闭编辑器时补存', () => {
  it('大白话：补存失败要提示、不发 saved；补存的是关闭那一刻的编辑', async () => {
    await open(0)
    await typeName('小熊改名')
    api.saveDraft.mockResolvedValueOnce({ ok: false, status: 500, error: 'X' })
    await btn('关闭').trigger('click')
    await flushPromises()
    expect(api.saveDraft).toHaveBeenCalledTimes(1)
    expect(api.saveDraft.mock.calls[0][0]).toMatchObject({ id: 'p1', name: '小熊改名' })
    expect(status()).toBe('关闭前有编辑未保存成功：X，请重新打开该商品检查')
    expect(w.emitted('saved')).toBeUndefined()
  })

  it('大白话：补存成功才发 saved、不留提示', async () => {
    await open(0)
    await typeName('小熊改名')
    await btn('关闭').trigger('click')
    await flushPromises()
    expect(w.emitted('saved')).toHaveLength(1)
    expect(status()).toBe('')
  })

  it('大白话：补存还没回包时已打开另一件商品——失败提示不标到新商品屏上', async () => {
    await open(0)
    await typeName('小熊改名')
    const save = pending()
    api.saveDraft.mockReturnValueOnce(save.p)
    await btn('关闭').trigger('click')
    await open(1)
    save.release({ ok: false, status: 500, error: 'X' })
    await flushPromises()
    expect(editorId()).toBe('p2')
    expect(status()).not.toContain('关闭前有编辑未保存成功')
  })
})

describe('Products.vue 保存草稿回包晚到', () => {
  it('大白话：保存在途时已切到另一件商品——回包不关掉新商品的编辑器，列表照样刷新', async () => {
    await open(0)
    await typeName('小熊改名')
    const save = pending()
    api.saveDraft.mockReturnValueOnce(save.p)
    await btn('保存草稿').trigger('click')
    await open(1)
    const listCalls = api.listDrafts.mock.calls.length
    save.release({ ok: true })
    await flushPromises()
    expect(editorId()).toBe('p2')
    expect(api.listDrafts.mock.calls.length).toBeGreaterThan(listCalls)
  })

  it('大白话：没切商品——保存成功关编辑器', async () => {
    await open(0)
    await typeName('小熊改名')
    await btn('保存草稿').trigger('click')
    await flushPromises()
    expect(editorId()).toBe('')
    expect(w.emitted('saved')!.length).toBeGreaterThan(0)
  })
})

describe('Products.vue 图片上传回包晚到', () => {
  const COVER = '.editor .grid input[type="file"]'
  const GALLERY = '.gallery .g-add input'

  it('大白话：封面上传没切商品——封面写进本商品', async () => {
    await open(0)
    api.uploadImage.mockResolvedValueOnce({ ok: true, fileID: 'cloud://c1', url: 'https://u/c1' })
    await pickFile(COVER)
    expect(api.uploadImage).toHaveBeenCalledWith('b64', 'p1', 'jpg')
    expect(w.find('.cover-wrap img').attributes('src')).toBe('https://u/c1')
  })

  it.each([
    [{ ok: true, fileID: 'cloud://c1', url: 'https://u/c1' }],
    [{ ok: false, status: 500, error: 'E' }],
  ])('大白话：封面上传在途时切到另一件商品——回包 %o 不写进新商品', async (res) => {
    await open(0)
    const up = pending()
    api.uploadImage.mockReturnValueOnce(up.p)
    await pickFile(COVER)
    await open(1)
    up.release(res)
    await flushPromises()
    expect(api.uploadImage).toHaveBeenCalledWith('b64', 'p1', 'jpg')
    expect(editorId()).toBe('p2')
    expect(w.find('.cover-wrap').exists()).toBe(false)
    expect(status()).not.toContain('图片上传失败')
  })

  it.each([['封面', COVER], ['相册', GALLERY]])('大白话：%s压缩期间切到另一件商品——仍按选图时那件商品上传', async (_, sel) => {
    await open(0)
    const zip = pending()
    vi.mocked(compressImage).mockReturnValueOnce(zip.p as Promise<string>)
    api.uploadImage.mockResolvedValueOnce({ ok: true, fileID: 'cloud://c1', url: 'https://u/c1' })
    await pickFile(sel)
    await open(1)
    zip.release('b64')
    await flushPromises()
    expect(api.uploadImage).toHaveBeenCalledWith('b64', 'p1', 'jpg')
  })

  it('大白话：相册上传没切商品——图进本商品相册', async () => {
    await open(0)
    api.uploadImage.mockResolvedValueOnce({ ok: true, fileID: 'cloud://g1', url: 'https://u/g1' })
    await pickFile(GALLERY)
    expect(w.findAll('.gallery .g-item')).toHaveLength(1)
  })

  it.each([
    [{ ok: true, fileID: 'cloud://g1', url: 'https://u/g1' }],
    [{ ok: false, status: 500, error: 'E' }],
  ])('大白话：相册上传在途时切到另一件商品——回包 %o 不塞进新商品', async (res) => {
    await open(0)
    const up = pending()
    api.uploadImage.mockReturnValueOnce(up.p)
    await pickFile(GALLERY)
    await open(1)
    up.release(res)
    await flushPromises()
    expect(api.uploadImage).toHaveBeenCalledWith('b64', 'p1', 'jpg')
    expect(editorId()).toBe('p2')
    expect(w.findAll('.gallery .g-item')).toHaveLength(0)
    expect(status()).not.toContain('有图上传失败')
  })
})

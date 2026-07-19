// @vitest-environment happy-dom
// Products.vue 上架两步确认渲染回归（B9）：doPublish 走 twoStep(key, run)——第一次点武装（confirmKey 置位、
// 按钮文案变确认态），第二次点才真调用 publishProduct。此前只有 mapProducts 纯函数单测/?raw 字符串断言覆盖，
// 模板 @click 接线与 confirmKey 判据从未被真跑过。Products.vue 顶层 useRouter() 依赖真实 vue-router 实例
// （相对导入 + 同一 router 插件安装，避免 dual-package 身份不一致导致 useRouter() 拿到 undefined）。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'

const { listDraftsMock, saveDraftMock, deleteDraftMock, uploadImageMock, publishProductMock, unpublishProductMock, republishProductMock } = vi.hoisted(() => ({
  listDraftsMock: vi.fn(),
  saveDraftMock: vi.fn(),
  deleteDraftMock: vi.fn(),
  uploadImageMock: vi.fn(),
  publishProductMock: vi.fn(),
  unpublishProductMock: vi.fn(),
  republishProductMock: vi.fn(),
}))
vi.mock('../src/api/products', () => ({
  listDrafts: listDraftsMock,
  saveDraft: saveDraftMock,
  deleteDraft: deleteDraftMock,
  uploadImage: uploadImageMock,
  publishProduct: publishProductMock,
  unpublishProduct: unpublishProductMock,
  republishProduct: republishProductMock,
}))

import Products from '../src/pages/Products.vue'

beforeEach(() => {
  listDraftsMock.mockReset().mockResolvedValue({
    ok: true,
    list: [{ id: 'p1', name: '钩织材料包·筹备款', price: '99', skus: [], images: [] }],
    urls: {},
    listed: {}, // p1 不在 listed 表 → state='preparing'
    hasVideo: {},
    cardFinal: {},
    hasBatch: {},
  })
  publishProductMock.mockReset().mockResolvedValue({ ok: true })
})

async function mountWithRouter() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div/>' } }] })
  await router.push('/')
  await router.isReady()
  return mount(Products, { global: { plugins: [router] } })
}

describe('Products.vue 上架两步确认（twoStep：doPublish）', () => {
  it('大白话：筹备中商品第一次点「上架」只武装不调用，第二次点「确认上架？」才恰好调用一次 publishProduct(id)', async () => {
    const wrapper = await mountWithRouter()
    await flushPromises()

    const findPublishBtn = () => wrapper.findAll('.ld-tr button').find((b) => b.text() === '上架' || b.text() === '确认上架？')
    const btn = findPublishBtn()
    expect(btn).toBeTruthy()
    expect(btn!.text()).toBe('上架')

    await btn!.trigger('click')
    await flushPromises()
    expect(publishProductMock).not.toHaveBeenCalled()
    expect(findPublishBtn()!.text()).toBe('确认上架？')

    await findPublishBtn()!.trigger('click')
    await flushPromises()
    expect(publishProductMock).toHaveBeenCalledTimes(1)
    expect(publishProductMock).toHaveBeenCalledWith('p1')
  })
})

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

describe('Products.vue 操作列收敛（主操作 + ⋯更多菜单）：菜单里的删除是可见文案两步确认', () => {
  it('大白话：⋯菜单里的删除第一下变「连已上架一起删？」且不调用，第二下才恰好调用一次 deleteDraft(\'p1\')', async () => {
    deleteDraftMock.mockReset().mockResolvedValue({ ok: true })
    const wrapper = await mountWithRouter()
    await flushPromises()

    const moreBtn = wrapper.findAll('.ld-tr button').find((b) => b.attributes('title') === '更多操作')
    expect(moreBtn).toBeTruthy()
    await moreBtn!.trigger('click')
    await flushPromises()

    const findDeleteBtn = () => wrapper.findAll('.more-menu button').find((b) => b.text() === '删除' || b.text() === '连已上架一起删？')
    const delBtn = findDeleteBtn()
    expect(delBtn).toBeTruthy()
    expect(delBtn!.text()).toBe('删除')

    await delBtn!.trigger('click')
    await flushPromises()
    expect(deleteDraftMock).not.toHaveBeenCalled()
    expect(findDeleteBtn()!.text()).toBe('连已上架一起删？')

    await findDeleteBtn()!.trigger('click')
    await flushPromises()
    expect(deleteDraftMock).toHaveBeenCalledTimes(1)
    expect(deleteDraftMock).toHaveBeenCalledWith('p1')
  })
})

// 终审对抗审查 P1 回归锁：⋯菜单的「关闭」是取消手势——必须连带解除两步武装（否则武装残留、
// 重开菜单一击直发真删除）；fixed 坐标只在打开瞬间准——页面一滚动必须收起（scroll 不触发 click，
// backdrop 挡不住滚轮·原注释的免责理由被审查证伪）。
describe('⋯菜单关闭语义（终审 P1：关闭即解除武装 + 滚动即收起）', () => {
  it('大白话：武装「删除」后点 backdrop 关菜单再重开——按钮必须回到「删除」，第一下只武装不执行', async () => {
    deleteDraftMock.mockReset().mockResolvedValue({ ok: true })
    const wrapper = await mountWithRouter()
    await flushPromises()
    const moreBtn = wrapper.findAll('.ld-tr button').find((b) => b.attributes('title') === '更多操作')
    await moreBtn!.trigger('click')
    await flushPromises()
    const findDeleteBtn = () => wrapper.findAll('.more-menu button').find((b) => b.text() === '删除' || b.text() === '连已上架一起删？')
    await findDeleteBtn()!.trigger('click') // 第一击：武装
    await flushPromises()
    expect(findDeleteBtn()!.text()).toBe('连已上架一起删？')
    await wrapper.find('.more-backdrop').trigger('mousedown') // 最自然的「算了」手势
    await flushPromises()
    expect(wrapper.find('.more-menu').exists()).toBe(false)
    await moreBtn!.trigger('click') // 重开
    await flushPromises()
    expect(findDeleteBtn()!.text()).toBe('删除') // 武装必须已解除
    await findDeleteBtn()!.trigger('click')
    await flushPromises()
    expect(deleteDraftMock).not.toHaveBeenCalled() // 重开后第一下仍只是武装、绝不直发
  })

  it('大白话：菜单开着时页面一滚动就收起——fixed 菜单不跟行走，滚动后可能视觉对到别的行上', async () => {
    const wrapper = await mountWithRouter()
    await flushPromises()
    const moreBtn = wrapper.findAll('.ld-tr button').find((b) => b.attributes('title') === '更多操作')
    await moreBtn!.trigger('click')
    await flushPromises()
    expect(wrapper.find('.more-menu').exists()).toBe(true)
    window.dispatchEvent(new Event('scroll'))
    await flushPromises()
    expect(wrapper.find('.more-menu').exists()).toBe(false)
  })
})

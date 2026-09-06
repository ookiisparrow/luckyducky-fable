// @vitest-environment happy-dom
// 上新向导 /launch → /products/:id/wizard 同实例切路由：建档成功后不得闪「没有找到这个商品」。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { freshDraft } from '../src/lib/mapProducts'

const { listDraftsMock, saveDraftMock, publishProductMock } = vi.hoisted(() => ({
  listDraftsMock: vi.fn(),
  saveDraftMock: vi.fn(),
  publishProductMock: vi.fn(),
}))
vi.mock('../src/api/products', () => ({
  listDrafts: listDraftsMock,
  saveDraft: saveDraftMock,
  publishProduct: publishProductMock,
}))

import Wizard from '../src/pages/Wizard.vue'

const stubs = {
  Products: true,
  Courses: true,
  Cards: true,
  Batches: true,
  PageHeader: { props: ['title', 'sub'], template: '<div class="ph"><h1>{{ title }}</h1><p>{{ sub }}</p><slot /></div>' },
  EmptyState: { props: ['text'], template: '<div class="empty">{{ text }}<slot /></div>' },
  UiButton: { template: '<button><slot /></button>' },
  Badge: { template: '<span><slot /></span>' },
}

beforeEach(() => {
  listDraftsMock.mockReset()
  saveDraftMock.mockReset().mockResolvedValue({ ok: true })
  publishProductMock.mockReset().mockResolvedValue({ ok: true })
})

describe('上新向导 /launch 建档不闪「商品不存在」（polish 自检 P1）', () => {
  it('大白话：点「建立草稿」后、列表还没回来前，只转圈不谎称商品找不到', async () => {
    let releaseList: (v: unknown) => void = () => {}
    listDraftsMock.mockReturnValue(
      new Promise((resolve) => {
        releaseList = resolve
      }),
    )
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/launch', component: Wizard },
        { path: '/products/:id/wizard', component: Wizard },
        { path: '/products', component: { template: '<div/>' } },
      ],
    })
    await router.push('/launch')
    await router.isReady()
    const wrapper = mount(Wizard, { global: { plugins: [router], stubs } })
    await flushPromises()
    expect(wrapper.text()).toContain('建立草稿')
    expect(wrapper.text()).not.toContain('没有找到这个商品')

    const go = wrapper.findAll('button').find((b) => b.text().includes('建立草稿'))
    expect(go).toBeTruthy()
    await go!.trigger('click')
    await flushPromises()

    expect(saveDraftMock).toHaveBeenCalledTimes(1)
    const saved = saveDraftMock.mock.calls[0][0] as { id: string }
    expect(wrapper.text()).not.toContain('没有找到这个商品')
    expect(wrapper.text()).toContain('加载中')
    expect(router.currentRoute.value.path).toBe(`/products/${saved.id}/wizard`)

    releaseList({
      ok: true,
      list: [freshDraft(saved.id)],
      urls: {},
      listed: {},
      hasVideo: {},
      cardFinal: {},
      hasBatch: {},
    })
    await flushPromises()
    expect(wrapper.text()).not.toContain('没有找到这个商品')
    expect(wrapper.text()).toContain('新建与封面')
    wrapper.unmount()
  })

  it('大白话：建档后首包暂时读不到新档时，乐观写入保住向导，不误报「商品不存在」', async () => {
    listDraftsMock.mockResolvedValue({ ok: true, list: [], urls: {}, listed: {}, hasVideo: {}, cardFinal: {}, hasBatch: {} })
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/launch', component: Wizard },
        { path: '/products/:id/wizard', component: Wizard },
        { path: '/products', component: { template: '<div/>' } },
      ],
    })
    await router.push('/launch')
    await router.isReady()
    const wrapper = mount(Wizard, { global: { plugins: [router], stubs } })
    await flushPromises()
    const go = wrapper.findAll('button').find((b) => b.text().includes('建立草稿'))
    await go!.trigger('click')
    await flushPromises()
    expect(saveDraftMock).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('新建与封面')
    expect(wrapper.text()).not.toContain('没有找到这个商品')
    wrapper.unmount()
  })

  it('大白话：深链列表暂缺时不关死，点「重试」可继续进入向导', async () => {
    const draft = freshDraft('p-retry')
    listDraftsMock
      .mockResolvedValueOnce({ ok: true, list: [], urls: {}, listed: {}, hasVideo: {}, cardFinal: {}, hasBatch: {} })
      .mockResolvedValueOnce({
        ok: true,
        list: [draft],
        urls: {},
        listed: {},
        hasVideo: {},
        cardFinal: {},
        hasBatch: {},
      })
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/launch', component: Wizard },
        { path: '/products/:id/wizard', component: Wizard },
        { path: '/products', component: { template: '<div/>' } },
      ],
    })
    await router.push('/products/p-retry/wizard')
    await router.isReady()
    const wrapper = mount(Wizard, { global: { plugins: [router], stubs } })
    await flushPromises()
    expect(wrapper.text()).toContain('没有找到这个商品')
    expect(wrapper.text()).toContain('重试')
    const retry = wrapper.findAll('button').find((b) => b.text().includes('重试'))
    expect(retry).toBeTruthy()
    await retry!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('新建与封面')
    expect(wrapper.text()).not.toContain('没有找到这个商品')
    wrapper.unmount()
  })
})

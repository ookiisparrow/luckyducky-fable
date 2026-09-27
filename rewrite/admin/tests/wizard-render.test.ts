// @vitest-environment happy-dom
// 上新向导 /launch → /products/:id/wizard 同实例切路由：建档成功后不得闪「没有找到这个商品」。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { freshDraft } from '../src/lib/mapProducts'

const { listDraftsMock, saveDraftMock, publishProductMock, republishProductMock } = vi.hoisted(() => ({
  listDraftsMock: vi.fn(),
  saveDraftMock: vi.fn(),
  publishProductMock: vi.fn(),
  republishProductMock: vi.fn(),
}))
vi.mock('../src/api/products', () => ({
  listDrafts: listDraftsMock,
  saveDraft: saveDraftMock,
  publishProduct: publishProductMock,
  republishProduct: republishProductMock,
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
  republishProductMock.mockReset().mockResolvedValue({ ok: true })
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
    expect(wrapper.text()).toContain('可能已删除')
    expect(wrapper.text()).not.toContain('名单不全')
    expect(wrapper.text()).toContain('重试')
    const retry = wrapper.findAll('button').find((b) => b.text().includes('重试'))
    expect(retry).toBeTruthy()
    await retry!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('新建与封面')
    expect(wrapper.text()).not.toContain('没有找到这个商品')
    wrapper.unmount()
  })

  it('大白话：名单被截断才说列表不全；完整名单里没有，才说可能已删除', async () => {
    listDraftsMock.mockResolvedValue({
      ok: true,
      list: [freshDraft('other')],
      urls: {},
      listed: {},
      truncated: true,
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
    await router.push('/products/p-gone/wizard')
    await router.isReady()
    const wrapper = mount(Wizard, { global: { plugins: [router], stubs } })
    await flushPromises()
    expect(wrapper.text()).toContain('名单不全')
    expect(wrapper.text()).not.toContain('可能已删除')
    wrapper.unmount()
  })
})

describe('上新向导已下架同步（#211 #199）', () => {
  it('大白话：已下架向导顶同时有「同步草稿」和「恢复销售」，恢复不调 publishProduct', async () => {
    const draft = { ...freshDraft('p-off'), name: '下架款', cover: 'c', price: '99', skus: [{ name: '标', price: '99' }] }
    listDraftsMock.mockResolvedValue({
      ok: true,
      list: [draft],
      urls: {},
      listed: { 'p-off': false },
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
    await router.push('/products/p-off/wizard')
    await router.isReady()
    const wrapper = mount(Wizard, { global: { plugins: [router], stubs } })
    await flushPromises()
    const sync = wrapper.findAll('button').find((b) => b.text().includes('同步草稿'))
    const restore = wrapper.findAll('button').find((b) => b.text() === '恢复销售')
    expect(sync).toBeTruthy()
    expect(restore).toBeTruthy()
    await restore!.trigger('click')
    await flushPromises()
    expect(republishProductMock).not.toHaveBeenCalled()
    const confirm = wrapper.findAll('button').find((b) => b.text().includes('上次上架页'))
    expect(confirm).toBeTruthy()
    await confirm!.trigger('click')
    await flushPromises()
    expect(republishProductMock).toHaveBeenCalledTimes(1)
    expect(republishProductMock).toHaveBeenCalledWith('p-off')
    expect(publishProductMock).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('大白话：在售向导顶是「同步到小程序」，确认只说新价/新图，没有上架/重新上架/确认上架？', async () => {
    const draft = { ...freshDraft('p-on'), name: '在售款', cover: 'c', price: '99', skus: [{ name: '标', price: '99' }] }
    listDraftsMock.mockResolvedValue({
      ok: true,
      list: [draft],
      urls: {},
      listed: { 'p-on': true },
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
    await router.push('/products/p-on/wizard')
    await router.isReady()
    const wrapper = mount(Wizard, { global: { plugins: [router], stubs } })
    await flushPromises()
    const sync = wrapper.findAll('button').find((b) => b.text().includes('同步到小程序'))
    expect(sync).toBeTruthy()
    expect(wrapper.text()).not.toMatch(/重新上架|确认上架？/)
    expect(wrapper.findAll('button').some((b) => b.text() === '上架')).toBe(false)
    await sync!.trigger('click')
    await flushPromises()
    expect(publishProductMock).not.toHaveBeenCalled()
    const confirm = wrapper.findAll('button').find((b) => b.text().includes('顾客将看到新价/新图'))
    expect(confirm).toBeTruthy()
    expect(confirm!.text()).not.toMatch(/上架|重新上架|确认上架/)
    wrapper.unmount()
  })

  it('大白话：筹备中第一次上架要问「要不要同时出现在首页」，默认不勾，成功口写清首页没开', async () => {
    const draft = { ...freshDraft('p-new'), name: '新款', cover: 'c', price: '99', skus: [{ name: '标', price: '99' }] }
    listDraftsMock.mockResolvedValue({
      ok: true,
      list: [draft],
      urls: {},
      listed: {},
      hasVideo: {},
      coursePublished: {},
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
    await router.push('/products/p-new/wizard')
    await router.isReady()
    const wrapper = mount(Wizard, { global: { plugins: [router], stubs } })
    await flushPromises()
    expect(wrapper.text()).not.toContain('要不要同时出现在首页')
    const pub = wrapper.findAll('button').find((b) => b.text().includes('上架'))
    expect(pub).toBeTruthy()
    await pub!.trigger('click')
    await flushPromises()
    expect(publishProductMock).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('要不要同时出现在首页')
    const box = wrapper.find('.home-ask input')
    expect(box.exists()).toBe(true)
    expect((box.element as HTMLInputElement).checked).toBe(false)
    const confirm = wrapper.findAll('button').find((b) => b.text().includes('确认上架'))
    expect(confirm).toBeTruthy()
    await confirm!.trigger('click')
    await flushPromises()
    expect(publishProductMock).toHaveBeenCalledTimes(1)
    expect(publishProductMock).toHaveBeenCalledWith('p-new', { featured: false })
    expect(wrapper.text()).toContain('首页人气条未打开')
    expect(wrapper.text()).toContain('出现在首页')
    wrapper.unmount()
  })

  it('大白话：第 4 步写清商品上架不等于课程发布，进度能分开有视频和课已发布', async () => {
    const draft = { ...freshDraft('p-vid'), name: '有视频未发布', cover: 'c', price: '99', skus: [{ name: '标', price: '99' }] }
    listDraftsMock.mockResolvedValue({
      ok: true,
      list: [draft],
      urls: {},
      listed: {},
      hasVideo: { 'course-p-vid': true },
      coursePublished: {},
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
    await router.push({ path: '/products/p-vid/wizard', query: { step: '4' } })
    await router.isReady()
    const wrapper = mount(Wizard, { global: { plugins: [router], stubs } })
    await flushPromises()
    expect(wrapper.text()).toContain('商品上架 ≠ 课程发布')
    expect(wrapper.text()).toContain('先卖材料包')
    expect(wrapper.text()).toContain('有视频文件')
    expect(wrapper.text()).toContain('课已发布')
    const marks = wrapper.findAll('.video-mark')
    expect(marks).toHaveLength(2)
    expect(marks[0].classes()).toContain('on')
    expect(marks[1].classes()).not.toContain('on')
    wrapper.unmount()
  })

  it('大白话：向导图例钉验收词表四套字，禁另起别名', async () => {
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
    const text = wrapper.text()
    expect(text).toContain('上架')
    expect(text).toContain('第一次公开卖')
    expect(text).toContain('同步到小程序')
    expect(text).toContain('在售时把草稿推给顾客')
    expect(text).toContain('同步草稿')
    expect(text).toContain('恢复销售')
    expect(text).toContain('上次上架页')
    expect(text).not.toContain('重新上架')
    wrapper.unmount()
  })
})

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
    list: [{ id: 'p1', name: '钩织材料包·筹备款', price: '99', skus: [], images: [], params: [], detailSections: [], kit: [] }],
    urls: {},
    listed: {}, // p1 不在 listed 表 → state='preparing'
    hasVideo: {},
    cardFinal: {},
    hasBatch: {},
  })
  publishProductMock.mockReset().mockResolvedValue({ ok: true })
})

async function mountWithRouter() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div/>' } },
      { path: '/launch', component: { template: '<div/>' } },
      { path: '/products/:id/wizard', component: { template: '<div/>' } },
    ],
  })
  await router.push('/')
  await router.isReady()
  const wrapper = mount(Products, { global: { plugins: [router] } })
  return { wrapper, router }
}

describe('Products.vue 向导切片（1–3 步不再同一张大表）', () => {
  it('大白话：第 1 步只封面；第 2 步只名字和相册、不再逼传封面；第 3 步才是规格', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div/>' } }] })
    await router.push('/')
    await router.isReady()
    const cover = mount(Products, { props: { embed: true, wizardProductId: 'p1', wizardSlice: 1 }, global: { plugins: [router] } })
    await flushPromises()
    expect(cover.text()).toContain('封面图')
    expect(cover.text()).not.toContain('商品相册')
    expect(cover.text()).not.toContain('规格（SKU）')
    expect(cover.text()).not.toContain('销量')
    cover.unmount()
    const look = mount(Products, { props: { embed: true, wizardProductId: 'p1', wizardSlice: 2 }, global: { plugins: [router] } })
    await flushPromises()
    expect(look.text()).toContain('名称')
    expect(look.text()).toContain('商品相册')
    expect(look.text()).not.toContain('封面图')
    expect(look.text()).not.toContain('规格（SKU）')
    expect(look.text()).not.toContain('参数表')
    expect(look.text()).not.toContain('销量')
    look.unmount()
    const detail = mount(Products, { props: { embed: true, wizardProductId: 'p1', wizardSlice: 3 }, global: { plugins: [router] } })
    await flushPromises()
    expect(detail.text()).toContain('规格（SKU）')
    expect(detail.text()).toContain('一句话简介')
    expect(detail.text()).toContain('销量')
    expect(detail.text()).not.toContain('封面图')
    expect(detail.text()).not.toContain('商品相册')
    detail.unmount()
  })
})

describe('Products.vue 销量输入（#119 ①·后台手填）', () => {
  it('大白话：编辑器有销量框；填 128 点保存草稿，saveDraft 带着这个数', async () => {
    saveDraftMock.mockReset().mockResolvedValue({ ok: true })
    listDraftsMock.mockReset().mockResolvedValue({
      ok: true,
      list: [{ id: 'p1', name: '钩织材料包·筹备款', price: '99', sold: 0, skus: [], images: [], params: [], detailSections: [], kit: [] }],
      urls: {},
      listed: {},
      hasVideo: {},
      cardFinal: {},
      hasBatch: {},
    })
    const { wrapper } = await mountWithRouter()
    await flushPromises()
    const editBtn = wrapper.findAll('button').find((b) => b.text() === '编辑')
    expect(editBtn).toBeTruthy()
    await editBtn!.trigger('click')
    await flushPromises()
    const soldInput = wrapper.find('input[type="number"]')
    expect(soldInput.exists()).toBe(true)
    await soldInput.setValue(128)
    const saveBtn = wrapper.findAll('button').find((b) => b.text() === '保存草稿')
    expect(saveBtn).toBeTruthy()
    await saveBtn!.trigger('click')
    await flushPromises()
    expect(saveDraftMock).toHaveBeenCalled()
    const payload = saveDraftMock.mock.calls.find((c) => c[0] && Number(c[0].sold) === 128)?.[0]
    expect(payload).toBeTruthy()
    expect(payload.sold).toBe(128)
  })
})

describe('Products.vue 编辑器价格块与在售同步入口（#198 #199）', () => {
  it('大白话：价格/划线价/销量单独成一块，写明先存草稿顾客才看见；在售编辑器主按钮是「同步到小程序」', async () => {
    listDraftsMock.mockReset().mockResolvedValue({
      ok: true,
      list: [{ id: 'p1', name: '在售款', price: '99', sold: 0, skus: [], images: [], params: [], detailSections: [], kit: [] }],
      urls: {},
      listed: { p1: true },
      hasVideo: {},
      cardFinal: {},
      hasBatch: {},
    })
    const { wrapper } = await mountWithRouter()
    await flushPromises()
    const editBtn = wrapper.findAll('button').find((b) => b.text() === '编辑')
    await editBtn!.trigger('click')
    await flushPromises()
    expect(wrapper.find('.price-sales').exists()).toBe(true)
    expect(wrapper.text()).toContain('先存草稿，同步后顾客才见')
    const editorSync = wrapper.findAll('.editor-ops button').find((b) => b.text() === '同步到小程序')
    expect(editorSync).toBeTruthy()
    await editorSync!.trigger('click')
    await flushPromises()
    expect(publishProductMock).not.toHaveBeenCalled()
    expect(wrapper.findAll('.editor-ops button').some((b) => b.text() === '顾客将看到新价/新图')).toBe(true)
  })
})

describe('Products.vue 已下架：同步草稿 ≠ 恢复销售（#211）', () => {
  function unlistedList() {
    return {
      ok: true,
      list: [{ id: 'p1', name: '已下架款', price: '99', skus: [], images: [], params: [], detailSections: [], kit: [] }],
      urls: {},
      listed: { p1: false },
      hasVideo: {},
      cardFinal: {},
      hasBatch: {},
    }
  }

  it('大白话：已下架主区同时有「同步草稿」和「恢复销售」；恢复两步才调 republish，且绝不调 publishProduct', async () => {
    listDraftsMock.mockReset().mockResolvedValue(unlistedList())
    republishProductMock.mockReset().mockResolvedValue({ ok: true })
    const { wrapper } = await mountWithRouter()
    await flushPromises()
    const sync = wrapper.findAll('.ld-tr button').find((b) => b.text() === '同步草稿')
    const restore = wrapper.findAll('.ld-tr button').find((b) => b.text() === '恢复销售')
    expect(sync).toBeTruthy()
    expect(restore).toBeTruthy()
    expect(wrapper.findAll('.ld-tr button').some((b) => b.text() === '同步到小程序')).toBe(false)

    await restore!.trigger('click')
    await flushPromises()
    expect(republishProductMock).not.toHaveBeenCalled()
    expect(wrapper.findAll('.ld-tr button').some((b) => b.text().includes('上次上架页'))).toBe(true)

    const confirmRestore = wrapper.findAll('.ld-tr button').find((b) => b.text().includes('上次上架页'))
    await confirmRestore!.trigger('click')
    await flushPromises()
    expect(republishProductMock).toHaveBeenCalledTimes(1)
    expect(republishProductMock).toHaveBeenCalledWith('p1')
    expect(publishProductMock).not.toHaveBeenCalled()
  })

  it('大白话：已下架点「同步草稿」两步才调 publishProduct，不调 republish（恢复不会悄悄改价）', async () => {
    listDraftsMock.mockReset().mockResolvedValue(unlistedList())
    republishProductMock.mockReset().mockResolvedValue({ ok: true })
    const { wrapper } = await mountWithRouter()
    await flushPromises()
    const findSync = () => wrapper.findAll('.ld-tr button').find((b) => b.text() === '同步草稿' || b.text().includes('商品仍停售'))
    await findSync()!.trigger('click')
    await flushPromises()
    expect(publishProductMock).not.toHaveBeenCalled()
    await findSync()!.trigger('click')
    await flushPromises()
    expect(publishProductMock).toHaveBeenCalledTimes(1)
    expect(publishProductMock).toHaveBeenCalledWith('p1')
    expect(republishProductMock).not.toHaveBeenCalled()
  })
})

describe('Products.vue 列表武装不得漏进编辑器', () => {
  it('大白话：列表点过「同步到小程序」武装后进编辑，编辑器须回到未确认；再点一次只武装不发布；关掉编辑列表也不再武装', async () => {
    listDraftsMock.mockReset().mockResolvedValue({
      ok: true,
      list: [{ id: 'p1', name: '在售款', price: '99', sold: 0, skus: [], images: [], params: [], detailSections: [], kit: [] }],
      urls: {},
      listed: { p1: true },
      hasVideo: {},
      cardFinal: {},
      hasBatch: {},
    })
    const { wrapper } = await mountWithRouter()
    await flushPromises()
    const listSync = wrapper.findAll('.ld-tr button').find((b) => b.text() === '同步到小程序')
    expect(listSync).toBeTruthy()
    await listSync!.trigger('click')
    await flushPromises()
    expect(publishProductMock).not.toHaveBeenCalled()
    expect(wrapper.findAll('.ld-tr button').some((b) => b.text() === '顾客将看到新价/新图')).toBe(true)

    const editBtn = wrapper.findAll('.ld-tr button').find((b) => b.text() === '编辑')
    await editBtn!.trigger('click')
    await flushPromises()
    const editorSync = () => wrapper.findAll('.editor-ops button').find((b) => b.text() === '同步到小程序' || b.text() === '顾客将看到新价/新图')
    expect(editorSync()!.text()).toBe('同步到小程序')
    await editorSync()!.trigger('click')
    await flushPromises()
    expect(publishProductMock).not.toHaveBeenCalled()
    expect(editorSync()!.text()).toBe('顾客将看到新价/新图')

    const closeBtn = wrapper.findAll('.editor-ops button').find((b) => b.text() === '关闭')
    await closeBtn!.trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.ld-tr button').some((b) => b.text() === '同步到小程序')).toBe(true)
    expect(wrapper.findAll('.ld-tr button').some((b) => b.text() === '顾客将看到新价/新图')).toBe(false)
  })
})

describe('Products.vue 在售同步确认写清新价/新图（#199）', () => {
  it('大白话：在售第一次点「同步到小程序」只武装，确认文案写顾客将看到新价/新图，不再说上架', async () => {
    listDraftsMock.mockReset().mockResolvedValue({
      ok: true,
      list: [{ id: 'p1', name: '在售款', price: '99', skus: [], images: [], params: [], detailSections: [], kit: [] }],
      urls: {},
      listed: { p1: true },
      hasVideo: {},
      cardFinal: {},
      hasBatch: {},
    })
    const { wrapper } = await mountWithRouter()
    await flushPromises()
    const btn = wrapper.findAll('.ld-tr button').find((b) => b.text() === '同步到小程序')
    expect(btn).toBeTruthy()
    await btn!.trigger('click')
    await flushPromises()
    expect(publishProductMock).not.toHaveBeenCalled()
    const confirm = wrapper.findAll('.ld-tr button').find((b) => b.text() === '顾客将看到新价/新图')
    expect(confirm).toBeTruthy()
    expect(wrapper.text()).not.toMatch(/重新上架|确认上架？/)
  })
})

describe('Products.vue 上架两步确认（twoStep：doPublish）', () => {
  it('大白话：筹备中商品第一次点「上架」只武装不调用，第二次点「确认上架？」才恰好调用一次 publishProduct(id)', async () => {
    const { wrapper } = await mountWithRouter()
    await flushPromises()

    const findPublishBtn = () => wrapper.findAll('.ld-tr button').find((b) => b.text() === '上架' || b.text() === '确认上架？')
    const btn = findPublishBtn()
    expect(btn).toBeTruthy()
    expect(btn!.text()).toBe('上架')
    expect(wrapper.text()).not.toContain('要不要同时出现在首页')

    await btn!.trigger('click')
    await flushPromises()
    expect(publishProductMock).not.toHaveBeenCalled()
    expect(findPublishBtn()!.text()).toBe('确认上架？')
    expect(wrapper.text()).toContain('要不要同时出现在首页')
    const box = wrapper.find('.home-ask input')
    expect(box.exists()).toBe(true)
    expect((box.element as HTMLInputElement).checked).toBe(false)

    await findPublishBtn()!.trigger('click')
    await flushPromises()
    expect(publishProductMock).toHaveBeenCalledTimes(1)
    expect(publishProductMock).toHaveBeenCalledWith('p1', { featured: false })
    expect(wrapper.text()).toContain('首页人气条未打开')
  })

  it('大白话：第一次上架勾了「出现在首页」才把 featured:true 传给云端', async () => {
    const { wrapper } = await mountWithRouter()
    await flushPromises()
    const findPublishBtn = () => wrapper.findAll('.ld-tr button').find((b) => b.text() === '上架' || b.text() === '确认上架？')
    await findPublishBtn()!.trigger('click')
    await flushPromises()
    await wrapper.find('.home-ask input').setValue(true)
    await findPublishBtn()!.trigger('click')
    await flushPromises()
    expect(publishProductMock).toHaveBeenCalledWith('p1', { featured: true })
    expect(wrapper.text()).toContain('首页人气条')
    expect(wrapper.text()).toContain('出现在首页')
  })
})

describe('Products.vue 操作列收敛（主操作 + ⋯更多菜单）：菜单里的删除是可见文案两步确认', () => {
  it('大白话：⋯菜单里的删除第一下变「连已上架一起删？」且不调用，第二下才恰好调用一次 deleteDraft(\'p1\')', async () => {
    deleteDraftMock.mockReset().mockResolvedValue({ ok: true })
    const { wrapper } = await mountWithRouter()
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

  it('大白话：继续上新在操作列看得见，不必先点⋯；⋯里不再藏「上新向导」', async () => {
    const { wrapper, router } = await mountWithRouter()
    await flushPromises()
    expect(wrapper.findAll('button').some((b) => b.text() === '继续上新')).toBe(true)
    expect(wrapper.text()).toContain('去上新')
    expect(wrapper.text()).toMatch(/共 \d+ 款商品/)
    const cont = wrapper.findAll('button').find((b) => b.text() === '继续上新')
    await cont!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/products/p1/wizard')
    expect(String(router.currentRoute.value.query.step)).toBe('1')
    const moreBtn = wrapper.findAll('.ld-tr button').find((b) => b.attributes('title') === '更多操作')
    await moreBtn!.trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.more-menu button').some((b) => b.text() === '上新向导')).toBe(false)
  })
})

// 终审对抗审查 P1 回归锁：⋯菜单的「关闭」是取消手势——必须连带解除两步武装（否则武装残留、
// 重开菜单一击直发真删除）；fixed 坐标只在打开瞬间准——页面一滚动必须收起（scroll 不触发 click，
// backdrop 挡不住滚轮·原注释的免责理由被审查证伪）。
describe('⋯菜单关闭语义（终审 P1：关闭即解除武装 + 滚动即收起）', () => {
  it('大白话：武装「删除」后点 backdrop 关菜单再重开——按钮必须回到「删除」，第一下只武装不执行', async () => {
    deleteDraftMock.mockReset().mockResolvedValue({ ok: true })
    const { wrapper } = await mountWithRouter()
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
    const { wrapper } = await mountWithRouter()
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

describe('产品表空态 / 筛选 / 五步齐了（polish 自检）', () => {
  it('大白话：首包没回来前不谎报「还没有商品」', async () => {
    listDraftsMock.mockReset().mockReturnValue(new Promise(() => {}))
    const { wrapper } = await mountWithRouter()
    expect(wrapper.text()).not.toContain('还没有商品')
  })

  it('大白话：首包没回来前副标不写「共 0 款商品」', async () => {
    listDraftsMock.mockReset().mockReturnValue(new Promise(() => {}))
    const { wrapper } = await mountWithRouter()
    expect(wrapper.text()).not.toContain('共 0 款商品')
  })

  it('大白话：真的 0 款才说「还没有商品」，并仍看得见「去上新」', async () => {
    listDraftsMock.mockReset().mockResolvedValue({ ok: true, list: [], urls: {}, listed: {}, hasVideo: {}, cardFinal: {}, hasBatch: {} })
    const { wrapper } = await mountWithRouter()
    await flushPromises()
    expect(wrapper.text()).toContain('还没有商品，点「去上新」开始')
    expect(wrapper.text()).toContain('去上新')
    expect(wrapper.text()).toContain('共 0 款商品')
    expect(wrapper.text()).not.toContain('筹备中待完成上新')
  })

  it('大白话：筛「在售」对不上时说「没有符合筛选的商品」，不是「还没有商品」', async () => {
    const { wrapper } = await mountWithRouter()
    await flushPromises()
    const onsale = wrapper.findAll('.ld-chip').find((b) => b.text().includes('在售'))
    expect(onsale).toBeTruthy()
    await onsale!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('没有符合筛选的商品')
    expect(wrapper.text()).not.toContain('还没有商品')
  })

  it('大白话：五步齐了不再亮「继续上新」，筹备中主按钮是「上架」；进度写「上新完成」', async () => {
    listDraftsMock.mockReset().mockResolvedValue({
      ok: true,
      list: [{ id: 'p1', name: '齐活', price: '99', cover: 'c', skus: [{ name: '标', price: '99' }], images: [], params: [], detailSections: [], kit: [], courseId: 'course-p1' }],
      urls: {},
      listed: {},
      hasVideo: { 'course-p1': true },
      cardFinal: { p1: true },
      hasBatch: { 'course-p1': true },
    })
    const { wrapper } = await mountWithRouter()
    await flushPromises()
    expect(wrapper.text()).toContain('上新完成 · 课未发布')
    expect(wrapper.findAll('.vmark')).toHaveLength(2)
    expect(wrapper.findAll('.vmark.on')).toHaveLength(1)
    expect(wrapper.findAll('button').some((b) => b.text() === '继续上新')).toBe(false)
    const pub = wrapper.findAll('.ld-tr button').find((b) => b.text() === '上架')
    expect(pub).toBeTruthy()
    expect(pub!.classes().join(' ')).toMatch(/v-primary|is-sm/)
    expect(pub!.html()).toContain('v-primary')
  })
})

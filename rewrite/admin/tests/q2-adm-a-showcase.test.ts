// @vitest-environment happy-dom
// Showcase.vue 挂载测试：列表渲染、读失败说人话不装空、开关/拖动后防抖保存的参数、保存失败徽标、离页补存。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const api = vi.hoisted(() => ({ listShowcase: vi.fn(), saveShowcase: vi.fn() }))
vi.mock('../src/api/products', () => api)

import Showcase from '../src/pages/Showcase.vue'

// 形状照云端 listShowcase：products 原档 + cover→临时链映射
const list = [
  { _id: 'p1', name: '小鸭', sort: 1, featured: true, listed: true, price: '99', cover: 'cloud://a.png' },
  { _id: 'p2', name: '小兔', sort: 2, featured: false, listed: false, price: '59' },
]
beforeEach(() => {
  api.listShowcase.mockReset().mockResolvedValue({ ok: true, list, urls: { 'cloud://a.png': 'https://t/a.png' } })
  api.saveShowcase.mockReset().mockResolvedValue({ ok: true })
})
afterEach(() => {
  vi.useRealTimers()
})
const mountPage = async () => {
  const w = mount(Showcase)
  await flushPromises()
  return w
}
type W = Awaited<ReturnType<typeof mountPage>>
const panelNames = (w: W) => w.findAll('.panel .row .name').map((n) => n.text())
const settleSave = async () => {
  await vi.advanceTimersByTimeAsync(700)
  await flushPromises()
}

describe('Showcase.vue 加载', () => {
  it('大白话：读成功——右侧按排序列全部商品（下架的标出来），左侧手机只放「出现在首页」的', async () => {
    const w = await mountPage()
    expect(panelNames(w)).toEqual(['小鸭', '小兔已下架'])
    expect(w.findAll('.p-card').map((c) => c.find('.p-name').text())).toEqual(['小鸭'])
    expect(w.find('.p-card img').attributes('src')).toBe('https://t/a.png')
    expect(w.find('.ld-status').exists()).toBe(false)
  })

  it('大白话：读失败——说人话、不甩英文码，也不显「还没有可排序的商品」', async () => {
    api.listShowcase.mockResolvedValue({ ok: false, status: 0, error: 'NETWORK:Failed to fetch' })
    const w = await mountPage()
    expect(w.find('.ld-status').text()).toBe('加载失败：网络不通，请检查网络后重试。')
    expect(w.text()).not.toContain('还没有可排序的商品')
  })

  it('大白话：业务码读失败给中文兜底，码只挂括号里', async () => {
    api.listShowcase.mockResolvedValue({ ok: false, status: 500, error: 'DB_READ_FAIL' })
    const w = await mountPage()
    const t = w.find('.ld-status').text()
    expect(t).toMatch(/^加载失败：[一-鿿]/)
    expect(t).toContain('（DB_READ_FAIL）')
  })

  it('大白话：回包只说失败没给码，不显空括号', async () => {
    api.listShowcase.mockResolvedValue({ ok: false })
    const w = await mountPage()
    expect(w.find('.ld-status').text()).toBe('加载失败：请刷新重试')
  })

  it('大白话：真没商品才显空态', async () => {
    api.listShowcase.mockResolvedValue({ ok: true, list: [], urls: {} })
    const w = await mountPage()
    expect(w.text()).toContain('还没有可排序的商品')
  })
})

describe('Showcase.vue 自动保存', () => {
  it('大白话：点开关后停 700ms 才存，存的是整张表的排序和新开关状态', async () => {
    vi.useFakeTimers()
    const w = await mountPage()
    await w.findAll('.panel .switch')[1].trigger('click')
    expect(api.saveShowcase).not.toHaveBeenCalled()
    await settleSave()
    expect(api.saveShowcase).toHaveBeenCalledTimes(1)
    expect(api.saveShowcase).toHaveBeenCalledWith([
      { id: 'p1', sort: 1, featured: true },
      { id: 'p2', sort: 2, featured: true },
    ])
    expect(w.text()).toContain('已保存')
  })

  it('大白话：把第二个拖到第一个上面，存的排序跟着换', async () => {
    vi.useFakeTimers()
    const w = await mountPage()
    const rows = w.findAll('.panel .row')
    await rows[1].trigger('dragstart')
    await rows[0].trigger('drop')
    await settleSave()
    expect(panelNames(w)).toEqual(['小兔已下架', '小鸭'])
    expect(api.saveShowcase).toHaveBeenCalledWith([
      { id: 'p2', sort: 1, featured: false },
      { id: 'p1', sort: 2, featured: true },
    ])
  })

  it('大白话：保存没成功，徽标显「保存失败」，不显「已保存」', async () => {
    vi.useFakeTimers()
    api.saveShowcase.mockResolvedValue({ ok: false, status: 400, error: 'PARTIAL_WRITE:1' })
    const w = await mountPage()
    await w.findAll('.panel .switch')[0].trigger('click')
    await settleSave()
    expect(w.text()).toContain('保存失败')
    expect(w.text()).not.toContain('已保存')
  })

  it('大白话：改完没等到自动保存就离开页面，离页时补存', async () => {
    vi.useFakeTimers()
    const w = await mountPage()
    await w.findAll('.panel .switch')[1].trigger('click')
    w.unmount()
    await flushPromises()
    expect(api.saveShowcase).toHaveBeenCalledTimes(1)
    expect(api.saveShowcase.mock.calls[0][0][1]).toEqual({ id: 'p2', sort: 2, featured: true })
  })
})

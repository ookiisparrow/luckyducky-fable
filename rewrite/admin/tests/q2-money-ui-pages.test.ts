// @vitest-environment happy-dom
// 失败≠空态（Issue #388）：看板钱链告警没读全不显绿、卡片页商品读失败不装成「没商品信息」。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import CONTRACT from '../../../tests/contracts/admin-money.json'
import { transportErrorText } from '../src/lib/mapSystem'

const m = vi.hoisted(() => ({
  getDashboard: vi.fn(),
  refundCounts: vi.fn(),
  listInventory: vi.fn(),
  listDrafts: vi.fn(),
  getInspectStatus: vi.fn(),
  getCard: vi.fn(),
  saveCard: vi.fn(),
}))
vi.mock('../src/api/money', () => ({ getDashboard: m.getDashboard, refundCounts: m.refundCounts }))
vi.mock('../src/api/system', () => ({ listInventory: m.listInventory }))
vi.mock('../src/api/products', () => ({ listDrafts: m.listDrafts, getCard: m.getCard, saveCard: m.saveCard, uploadImage: vi.fn() }))
vi.mock('../src/api/ops', () => ({ getInspectStatus: m.getInspectStatus }))
vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }), useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }))

import Dashboard from '../src/pages/Dashboard.vue'
import Cards from '../src/pages/Cards.vue'

const sample = (name: string) => structuredClone((CONTRACT.cases as unknown as Record<string, { sample: any }>)[name].sample)

beforeEach(() => {
  const dash = sample('getDashboard')
  dash.txAlerts = { feeMismatch: [], refundMismatch: [], stuckRefunds: [], partial: false }
  m.getDashboard.mockReset().mockResolvedValue(dash)
  m.refundCounts.mockReset().mockResolvedValue({ ok: true, counts: { applied: 0 }, partial: false })
  m.listInventory.mockReset().mockResolvedValue({ ok: true, list: [] })
  m.listDrafts.mockReset().mockResolvedValue({ ok: true, list: [], urls: {}, listed: {} })
  m.getInspectStatus.mockReset().mockResolvedValue({ ok: true, openAnomalies: 0 })
  m.getCard.mockReset().mockResolvedValue({ ok: true, card: null })
  m.saveCard.mockReset().mockResolvedValue({ ok: true })
})

describe('Dashboard.vue 钱链告警没读全', () => {
  it('大白话：真的全清时显示「今日无待处理事项 ✓」', async () => {
    const w = mount(Dashboard)
    await flushPromises()
    expect(w.text()).toContain('今日无待处理事项 ✓')
  })

  it('大白话：告警查询部分失败、三类告警都空——不显绿色全清，明说告警没读全', async () => {
    const dash = sample('getDashboard')
    dash.txAlerts = { feeMismatch: [], refundMismatch: [], stuckRefunds: [], partial: true }
    m.getDashboard.mockResolvedValue(dash)
    const w = mount(Dashboard)
    await flushPromises()
    expect(w.text()).not.toContain('今日无待处理事项 ✓')
    expect(w.text()).toContain('钱链告警没读全')
    expect(w.text()).not.toContain('部分待处理计数没能加载') // 计数都读到了，不另报一条泛泛的红字
  })

  it('大白话：有别的待办撑出行动条时，告警没读全的「钱链告警」格子显示「?」，不显 0', async () => {
    const dash = sample('getDashboard')
    dash.txAlerts = { feeMismatch: [], refundMismatch: [], stuckRefunds: [], partial: true }
    dash.toShip = 2
    m.getDashboard.mockResolvedValue(dash)
    const w = mount(Dashboard)
    await flushPromises()
    const money = w.findAll('.todo').find((b) => b.text().includes('钱链告警'))!
    expect(money.find('.todo-n').text()).toBe('?')
    expect(money.classes()).not.toContain('zero')
  })
})

describe('Cards.vue 读失败显示错误', () => {
  beforeEach(() => m.listDrafts.mockResolvedValue({ ok: true, list: [{ id: 'p1', name: '小熊', courseId: 'c-bear' }], urls: {}, listed: {} }))

  it('大白话：商品列表读超时——显示传输错误，不拿「新商品」和猜的课程号拼一张新卡', async () => {
    m.listDrafts.mockResolvedValue({ ok: false, status: 0, error: 'CALL_TIMEOUT' })
    const w = mount(Cards, { props: { wizardProductId: 'p1' } })
    await flushPromises()
    expect(w.find('.err-line').text()).toContain(transportErrorText('CALL_TIMEOUT'))
    expect(w.find('.work').exists()).toBe(false) // 编辑器不出，就不会拿缺商品信息的新卡去自动保存
    expect(m.saveCard).not.toHaveBeenCalled()
  })

  it('大白话：商品列表读成功时照常出编辑器，新卡名字和课程号取商品的', async () => {
    const w = mount(Cards, { props: { wizardProductId: 'p1' } })
    await flushPromises()
    expect(w.find('.err-line').exists()).toBe(false)
    expect(w.find('.work').exists()).toBe(true)
    await w.find('.work input.in').setValue('改一下标题') // 触发自动保存，卸载时补存
    w.unmount()
    await flushPromises()
    expect(m.saveCard).toHaveBeenCalledWith(expect.objectContaining({ name: '小熊 · 激活卡', courseId: 'c-bear' }))
  })

  it('大白话：商品列表读到了但里面没有这个商品（超 100 个时列表不全）——显示错误，不拿「新商品」拼新卡', async () => {
    m.listDrafts.mockResolvedValue({ ok: true, list: [{ id: 'p2', name: '别的' }], urls: {}, listed: {} })
    const w = mount(Cards, { props: { wizardProductId: 'p1' } })
    await flushPromises()
    expect(w.find('.err-line').text()).toContain('没找到这个商品')
    expect(w.find('.work').exists()).toBe(false)
  })

  it('大白话：选择器模式（没带商品号）读失败——显示传输错误，不显「还没有商品」', async () => {
    m.listDrafts.mockResolvedValue({ ok: false, status: 0, error: 'NETWORK:Failed to fetch' })
    const w = mount(Cards)
    await flushPromises()
    expect(w.find('.err-line').text()).toContain(transportErrorText('NETWORK:x'))
    expect(w.text()).not.toContain('还没有商品')
  })
})

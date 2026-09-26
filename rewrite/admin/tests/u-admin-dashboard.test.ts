// @vitest-environment happy-dom
// Dashboard.vue 加载行为锁：副请求失败（client 不抛，一律回 ok:false）并入「部分计数没加载」提示，
// 告警笔数、最近动态时间照常显示。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const m = vi.hoisted(() => ({
  getDashboard: vi.fn(),
  refundCounts: vi.fn(),
  listInventory: vi.fn(),
  listDrafts: vi.fn(),
  getInspectStatus: vi.fn(),
  push: vi.fn(),
}))
vi.mock('../src/api/money', () => ({ getDashboard: m.getDashboard, refundCounts: m.refundCounts }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: m.push }) }))
vi.mock('../src/api/system', () => ({ listInventory: m.listInventory }))
vi.mock('../src/api/products', () => ({ listDrafts: m.listDrafts }))
vi.mock('../src/api/ops', () => ({ getInspectStatus: m.getInspectStatus }))

import Dashboard from '../src/pages/Dashboard.vue'
import { transportErrorText } from '../src/lib/mapSystem'

const at = new Date(2026, 0, 2, 3, 4).getTime()
beforeEach(() => {
  m.getDashboard.mockReset().mockResolvedValue({
    ok: true,
    stats: { users: 1 },
    toShip: 1,
    txAlerts: { feeMismatch: ['o1', 'o2'], refundMismatch: ['o3__l1'] },
    recentActivity: [{ type: 'order', at, text: '新订单 o1' }],
  })
  m.refundCounts.mockReset().mockResolvedValue({ ok: true, counts: { applied: 0 } })
  m.listInventory.mockReset().mockResolvedValue({ ok: true, list: [] })
  m.listDrafts.mockReset().mockResolvedValue({ ok: true, list: [], urls: {}, listed: {} })
  m.getInspectStatus.mockReset().mockResolvedValue({ ok: true, openAnomalies: 1 })
  m.push.mockReset()
})

describe('Dashboard.vue 加载', () => {
  it('大白话：全部成功时显示告警合计笔数、动态时间（月-日 时:分），不出「没加载全」提示', async () => {
    const w = mount(Dashboard)
    await flushPromises()
    expect(w.find('.alert-title').text()).toBe('交易异常待处理 · 3 笔')
    expect(w.find('.act-time').text()).toBe('01-02 03:04')
    expect(w.text()).toContain('1待发货') // 取看板 toShip
    expect(w.text()).toContain('1异常未处理')
    expect(w.text()).not.toContain('部分待处理计数没能加载')
  })

  it('大白话：异常计数请求超时，看板照常出，但提示部分计数没加载', async () => {
    m.getInspectStatus.mockResolvedValue({ ok: false, status: 0, error: 'CALL_TIMEOUT' })
    const w = mount(Dashboard)
    await flushPromises()
    expect(w.find('.alert-title').exists()).toBe(true)
    expect(w.text()).toContain('部分待处理计数没能加载')
    expect(w.text()).toContain('0异常未处理')
  })

  it('大白话：商品草稿回失败，同样提示部分计数没加载', async () => {
    m.listDrafts.mockResolvedValue({ ok: false, error: 'X' })
    const w = mount(Dashboard)
    await flushPromises()
    expect(w.text()).toContain('部分待处理计数没能加载')
  })

  it('大白话：看板没回待发货数（toShip），提示部分计数没加载，不把 0 当真', async () => {
    const d = await m.getDashboard()
    delete d.toShip
    m.getDashboard.mockResolvedValue(d)
    const w = mount(Dashboard)
    await flushPromises()
    expect(w.text()).toContain('部分待处理计数没能加载')
  })
})

describe('Dashboard.vue 看板读失败', () => {
  it('大白话：超时说人话，不甩 CALL_TIMEOUT', async () => {
    m.getDashboard.mockResolvedValue({ ok: false, status: 0, error: 'CALL_TIMEOUT' })
    const w = mount(Dashboard)
    await flushPromises()
    expect(w.find('.ld-status').text()).toBe('看板加载失败：' + transportErrorText('CALL_TIMEOUT'))
    expect(w.text()).not.toContain('CALL_TIMEOUT')
  })
})

describe('Dashboard.vue 跳转', () => {
  it('大白话：告警「去处理」——金额不符单去订单页不带单号；退款类恰好 1 条带反解出的单号去售后页；多条只去列表', async () => {
    m.getDashboard.mockResolvedValue({ ok: true, stats: { users: 1 }, toShip: 0, txAlerts: { feeMismatch: ['o1'], refundMismatch: ['o3__p1__'], stuckRefunds: ['a1', 'a2'] } })
    const w = mount(Dashboard)
    await flushPromises()
    for (const b of w.findAll('.alert-row button')) await b.trigger('click')
    expect(m.push.mock.calls.map((c) => c[0])).toEqual([
      { path: '/orders', query: {} },
      { path: '/refunds', query: { q: 'o3' } },
      { path: '/refunds', query: {} },
    ])
  })

  it('大白话：「异常未处理」格子点进异常监测页', async () => {
    const w = mount(Dashboard)
    await flushPromises()
    await w.findAll('.todo').find((t) => t.text().includes('异常未处理'))!.trigger('click')
    expect(m.push).toHaveBeenCalledWith('/anomalies')
  })
})

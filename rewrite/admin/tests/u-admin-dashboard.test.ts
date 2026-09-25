// @vitest-environment happy-dom
// Dashboard.vue 加载行为锁：副请求失败（回失败或直接抛）都并入「部分计数没加载」提示，
// 告警笔数、最近动态时间照常显示。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const m = vi.hoisted(() => ({
  getDashboard: vi.fn(),
  orderCounts: vi.fn(),
  refundCounts: vi.fn(),
  listInventory: vi.fn(),
  listDrafts: vi.fn(),
  getInspectStatus: vi.fn(),
}))
vi.mock('../src/api/money', () => ({ getDashboard: m.getDashboard, orderCounts: m.orderCounts, refundCounts: m.refundCounts }))
vi.mock('../src/api/system', () => ({ listInventory: m.listInventory }))
vi.mock('../src/api/products', () => ({ listDrafts: m.listDrafts }))
vi.mock('../src/api/ops', () => ({ getInspectStatus: m.getInspectStatus }))

import Dashboard from '../src/pages/Dashboard.vue'

const at = new Date(2026, 0, 2, 3, 4).getTime()
beforeEach(() => {
  m.getDashboard.mockReset().mockResolvedValue({
    ok: true,
    stats: { users: 1 },
    txAlerts: { feeMismatch: ['o1', 'o2'], refundMismatch: ['o3__l1'] },
    recentActivity: [{ type: 'order', at, text: '新订单 o1' }],
  })
  m.orderCounts.mockReset().mockResolvedValue({ ok: true, counts: { paid: 2 } })
  m.refundCounts.mockReset().mockResolvedValue({ ok: true, counts: { applied: 0 } })
  m.listInventory.mockReset().mockResolvedValue({ ok: true, list: [] })
  m.listDrafts.mockReset().mockResolvedValue({ ok: true, list: [], urls: {}, listed: {} })
  m.getInspectStatus.mockReset().mockResolvedValue({ ok: true, openAnomalies: 1 })
})

describe('Dashboard.vue 加载', () => {
  it('大白话：全部成功时显示告警合计笔数、动态时间（月-日 时:分），不出「没加载全」提示', async () => {
    const w = mount(Dashboard)
    await flushPromises()
    expect(w.find('.alert-title').text()).toBe('交易异常待处理 · 3 笔')
    expect(w.find('.act-time').text()).toBe('01-02 03:04')
    expect(w.text()).toContain('2待发货')
    expect(w.text()).toContain('1异常未处理')
    expect(w.text()).not.toContain('部分待处理计数没能加载')
  })

  it('大白话：异常计数请求直接抛错，看板照常出，但提示部分计数没加载', async () => {
    m.getInspectStatus.mockRejectedValue(new Error('boom'))
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
})

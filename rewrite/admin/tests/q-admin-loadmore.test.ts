// @vitest-environment happy-dom
// 钱页「加载更多」失败不静默：给人话、已加载的行不动、按钮还在可重试；重试成功后提示消失（同小程序订单列表口径）。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'

const m = vi.hoisted(() => ({
  listOrders: vi.fn(),
  orderCounts: vi.fn(),
  listRefunds: vi.fn(),
  refundCounts: vi.fn(),
}))
vi.mock('../src/api/money', () => ({
  listOrders: m.listOrders,
  orderCounts: m.orderCounts,
  getOrderDetail: vi.fn(),
  shipOrder: vi.fn(),
  shipOrders: vi.fn(),
  clearFeeMismatch: vi.fn(),
  recordPaidFee: vi.fn(),
  listRefunds: m.listRefunds,
  refundCounts: m.refundCounts,
  getRefundDetail: vi.fn(),
  approveRefund: vi.fn(),
  rejectRefund: vi.fn(),
  overrideRefund: vi.fn(),
}))

import Orders from '../src/pages/Orders.vue'
import Refunds from '../src/pages/Refunds.vue'

const order = (id: string) => ({ id, status: 'paid', items: [{ productId: 'p', name: '材料包', qty: 1 }], amount: 99, createdAt: 1 })
const refund = (id: string) => ({ _id: id, orderId: 'o' + id, status: 'applied', name: '材料包', qty: 1, refundAmount: 99, appliedAt: 1 })

async function mountWithRouter(comp: unknown) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div/>' } }] })
  await router.push('/')
  await router.isReady()
  const w = mount(comp as never, { global: { plugins: [router] } })
  await flushPromises()
  return w
}
const moreBtn = (w: VueWrapper) => w.findAll('button').find((b) => b.text() === '加载更多')

beforeEach(() => {
  m.orderCounts.mockReset().mockResolvedValue({ ok: true, counts: {} })
  m.refundCounts.mockReset().mockResolvedValue({ ok: true, counts: {} })
})

describe.each([
  ['Orders', Orders, m.listOrders, order],
  ['Refunds', Refunds, m.listRefunds, refund],
] as const)('%s.vue 加载更多失败', (_name, comp, listMock, row) => {
  it('大白话：翻页失败给人话、已有行不动、按钮还在；再点成功后提示消失', async () => {
    listMock
      .mockReset()
      .mockResolvedValueOnce({ ok: true, list: [row('1')], nextCursor: 'c1', hasMore: true })
      .mockResolvedValueOnce({ ok: false, status: 0, error: 'CALL_TIMEOUT' })
      .mockResolvedValueOnce({ ok: true, list: [row('2')], nextCursor: null, hasMore: false })
    const w = await mountWithRouter(comp)
    const before = w.findAll('.ld-tr').length

    await moreBtn(w)!.trigger('click')
    await flushPromises()
    expect(w.text()).toContain('加载更多失败')
    expect(w.text()).not.toContain('CALL_TIMEOUT')
    expect(w.findAll('.ld-tr').length).toBe(before)
    expect(moreBtn(w)).toBeTruthy()
    expect(listMock.mock.calls[2 - 1][1]).toBe('c1')

    await moreBtn(w)!.trigger('click')
    await flushPromises()
    expect(listMock.mock.calls[2][1]).toBe('c1') // 重试用的还是同一个游标
    expect(w.findAll('.ld-tr').length).toBe(before + 1)
    expect(w.text()).not.toContain('加载更多失败')
  })
})

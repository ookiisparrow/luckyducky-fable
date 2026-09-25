// @vitest-environment happy-dom
// Orders.vue 抽屉激活态取数失败要看得见：不与「还在加载/无激活」混成同一片空白（失败≠空态·病根#14）。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const { listOrdersMock, getOrderDetailMock } = vi.hoisted(() => ({ listOrdersMock: vi.fn(), getOrderDetailMock: vi.fn() }))
vi.mock('../src/api/money', () => ({
  listOrders: listOrdersMock,
  orderCounts: vi.fn().mockResolvedValue({ ok: true, counts: { paid: 1, all: 1 } }),
  getOrderDetail: getOrderDetailMock,
  shipOrder: vi.fn(),
  shipOrders: vi.fn(),
  clearFeeMismatch: vi.fn(),
  recordPaidFee: vi.fn(),
}))

import Orders from '../src/pages/Orders.vue'

beforeEach(() => {
  listOrdersMock.mockResolvedValue({
    ok: true,
    list: [{ id: 'o1', status: 'paid', items: [{ productId: 'p1', name: '材料包', qty: 1 }], amount: 9900, createdAt: Date.now(), address: { name: '张三' } }],
    nextCursor: null,
    hasMore: false,
  })
  getOrderDetailMock.mockReset()
})

async function openShipDrawer() {
  const w = mount(Orders)
  await flushPromises()
  await w.findAll('.ld-tr button').find((b) => b.text() === '发货')!.trigger('click')
  await flushPromises()
  return w
}

describe('Orders.vue 抽屉激活态取数失败可见', () => {
  it('大白话：getOrderDetail 回失败，商品卡里写明激活状态没加载到', async () => {
    getOrderDetailMock.mockResolvedValue({ ok: false, status: 500, error: 'DB_READ_FAIL' })
    const w = await openShipDrawer()
    expect(w.find('.items-card').text()).toContain('激活状态没加载到')
  })

  it('大白话：getOrderDetail 直接抛错，同样显示没加载到，不静默', async () => {
    getOrderDetailMock.mockRejectedValue(new TypeError("Cannot read properties of null (reading 'ok')"))
    const w = await openShipDrawer()
    expect(w.find('.items-card').text()).toContain('激活状态没加载到')
  })

  it('大白话：取数成功时不出现失败提示', async () => {
    getOrderDetailMock.mockResolvedValue({ ok: true, activations: {} })
    const w = await openShipDrawer()
    expect(w.find('.items-card').text()).not.toContain('没加载到')
  })
})

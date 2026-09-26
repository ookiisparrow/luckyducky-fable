// @vitest-environment happy-dom
// 订单页发部分退款的单：抽屉/批量面板标出已退的件，发货时把看到的已退件数回传 shipOne 核对
// （服务端首次发货要求 ackRefundedQty 与现状一致，否则 REFUND_LINES_CHANGED）。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { mapOrderRows, orderErrorText } from '../src/lib/mapMoney'

const { listOrdersMock, shipOrderMock, shipOrdersMock } = vi.hoisted(() => ({ listOrdersMock: vi.fn(), shipOrderMock: vi.fn(), shipOrdersMock: vi.fn() }))
vi.mock('../src/api/money', () => ({
  listOrders: listOrdersMock,
  orderCounts: vi.fn().mockResolvedValue({ ok: true, counts: { paid: 1, all: 1 } }),
  getOrderDetail: vi.fn().mockResolvedValue({ ok: true, activations: {} }),
  shipOrder: shipOrderMock,
  shipOrders: shipOrdersMock,
  clearFeeMismatch: vi.fn(),
  recordPaidFee: vi.fn(),
}))

import Orders from '../src/pages/Orders.vue'

// listOrders 的真实回包形状：refundedQty 按行键（新单 lineId、旧单 productId）给已退件数
const partial = {
  id: 'o1',
  status: 'paid',
  amount: 140,
  createdAt: Date.now(),
  refundHold: false,
  refundedQty: { 'addon-yarn__': 1, ghost__: 1 },
  items: [
    { productId: 'p1', lineId: 'p1__红', spec: '红', name: '小熊', qty: 1 },
    { productId: 'addon-yarn', lineId: 'addon-yarn__', spec: '', name: '线包', qty: 2 },
  ],
  address: { name: '张三' },
}

beforeEach(() => {
  listOrdersMock.mockReset().mockResolvedValue({ ok: true, list: [partial], nextCursor: null, hasMore: false })
  shipOrderMock.mockReset().mockResolvedValue({ ok: true })
  shipOrdersMock.mockReset().mockResolvedValue({ ok: true, results: [{ id: 'o1', ok: true }] })
})

describe('mapOrderRows 已退件数', () => {
  it('大白话：每行带已退件数；回传核对只放对上了商品行的（ghost 行不替操作员说「看到了」）', () => {
    const [r] = mapOrderRows([partial])
    expect(r.items.map((it) => it.refundedQty)).toEqual([0, 1])
    expect(r.ackRefundedQty).toEqual({ 'addon-yarn__': 1 })
    expect(r.canShip).toBe(true)
  })

  it('大白话：旧单没有 lineId，按 productId 对上', () => {
    const [r] = mapOrderRows([{ id: 'o2', status: 'paid', refundedQty: { p9: 2 }, items: [{ productId: 'p9', name: '旧包', qty: 3 }] }])
    expect(r.items[0].refundedQty).toBe(2)
    expect(r.ackRefundedQty).toEqual({ p9: 2 })
  })

  it('大白话：REFUND_LINES_CHANGED 有人话，不甩英文码', () => {
    const t = orderErrorText('REFUND_LINES_CHANGED')
    expect(t).toMatch(/又有商品退款.*重新装箱/)
    expect(t).not.toContain('REFUND_LINES_CHANGED')
  })
})

describe('Orders.vue 部分退款单发货', () => {
  it('大白话：抽屉里线包标「已退 1 件·别发」，确认发货带上已退件数', async () => {
    const w = mount(Orders)
    await flushPromises()
    await w.findAll('.ld-tr button').find((b) => b.text() === '发货')!.trigger('click')
    await flushPromises()
    const lines = w.findAll('.ditem').map((x) => x.text())
    expect(lines[0]).not.toContain('已退')
    expect(lines[1]).toContain('已退 1 件·别发')
    await w.find('input[placeholder="扫描或输入运单号"]').setValue('SF1')
    await w.findAll('.drawer button').find((b) => b.text().includes('确认发货'))!.trigger('click')
    await flushPromises()
    expect(shipOrderMock).toHaveBeenCalledWith('o1', expect.any(String), 'SF1', { 'addon-yarn__': 1 })
    expect(w.find('.drawer').exists()).toBe(false)
  })

  it('大白话：批量面板也写明哪件已退别发，批量发货逐单带上已退件数', async () => {
    const w = mount(Orders)
    await flushPromises()
    await w.findAll('.ld-tr input.ck')[0].trigger('change')
    await w.findAll('.batchbar button').find((b) => b.text() === '批量发货')!.trigger('click')
    await flushPromises()
    expect(w.find('.batch-row').text()).toContain('线包 ×1')
    await w.find('.batch-row input').setValue('SF2')
    await w.findAll('.drawer button').find((b) => b.text().includes('确认发货'))!.trigger('click')
    await flushPromises()
    expect(shipOrdersMock).toHaveBeenCalledWith([{ id: 'o1', trackingNo: 'SF2', ackRefundedQty: { 'addon-yarn__': 1 } }], expect.any(String))
  })

  // 面板里的「已退款·别装」是打开那一刻的：服务端说件数变了，面板里没处刷新，也不能悄悄换成操作员没看到的新件数
  it('大白话：批量发货某单件数变了——那行指路「关掉面板刷新重选」、不能再重试；别的失败单照常重试', async () => {
    listOrdersMock.mockResolvedValue({ ok: true, list: [partial, { ...partial, id: 'o2' }], nextCursor: null, hasMore: false })
    shipOrdersMock.mockResolvedValueOnce({
      ok: true,
      results: [
        { id: 'o1', ok: false, error: 'REFUND_LINES_CHANGED', refundedQty: { 'addon-yarn__': 2 } },
        { id: 'o2', ok: false, error: 'SHIP_IN_PROGRESS' },
      ],
    })
    const w = mount(Orders)
    await flushPromises()
    for (const ck of w.findAll('.ld-tr input.ck')) await ck.trigger('change')
    await w.findAll('.batchbar button').find((b) => b.text() === '批量发货')!.trigger('click')
    await flushPromises()
    const inputs = w.findAll('.batch-row input')
    await inputs[0].setValue('SF1')
    await inputs[1].setValue('SF2')
    const confirm = () => w.findAll('.drawer button').find((b) => b.text().includes('确认发货'))!
    await confirm().trigger('click')
    await flushPromises()
    const [r1] = w.findAll('.batch-row')
    expect(r1.text()).toContain('关掉面板')
    expect((r1.find('input').element as HTMLInputElement).disabled).toBe(true)
    await confirm().trigger('click')
    await flushPromises()
    expect(shipOrdersMock.mock.calls[1][0]).toEqual([{ id: 'o2', trackingNo: 'SF2', ackRefundedQty: { 'addon-yarn__': 1 } }])
  })
})

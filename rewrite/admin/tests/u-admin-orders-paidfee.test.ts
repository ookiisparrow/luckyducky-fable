// @vitest-environment happy-dom
// Orders.vue 补录实付：这笔金额是退款依据，超两位小数的输入必须报错让人重填，不能静默四舍五入入库。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const { recordPaidFeeMock } = vi.hoisted(() => ({ recordPaidFeeMock: vi.fn() }))
vi.mock('../src/api/money', () => ({
  listOrders: vi.fn().mockResolvedValue({
    ok: true,
    list: [{ id: 'o1', status: 'payment_exception', items: [{ productId: 'p1', name: '材料包', qty: 1 }], amount: 9900, createdAt: Date.now(), address: { name: '张三' } }],
    nextCursor: null,
    hasMore: false,
  }),
  orderCounts: vi.fn().mockResolvedValue({ ok: true, counts: { all: 1 } }),
  getOrderDetail: vi.fn(),
  shipOrder: vi.fn(),
  shipOrders: vi.fn(),
  clearFeeMismatch: vi.fn(),
  recordPaidFee: recordPaidFeeMock,
}))

import Orders from '../src/pages/Orders.vue'

beforeEach(() => {
  recordPaidFeeMock.mockReset().mockResolvedValue({ ok: true })
})

async function recordWith(input: string) {
  vi.stubGlobal('prompt', () => input)
  const w = mount(Orders)
  await flushPromises()
  await w.findAll('.ld-tr button').find((b) => b.text() === '补录实付')!.trigger('click')
  await flushPromises()
  return w
}

describe('Orders.vue 补录实付金额校验', () => {
  it('大白话：输入 12.345 元，不发请求、提示金额不合法（不偷偷改成 12.35）', async () => {
    const w = await recordWith('12.345')
    expect(recordPaidFeeMock).not.toHaveBeenCalled()
    expect(w.find('.ld-status').text()).toContain('补录失败')
  })

  it('大白话：输入 1e307 这种换算后溢出的数，本地就拦下不发请求', async () => {
    const w = await recordWith('1e307')
    expect(recordPaidFeeMock).not.toHaveBeenCalled()
    expect(w.find('.ld-status').text()).toContain('补录失败')
  })

  it('大白话：输入 12.34 元，按 1234 分提交', async () => {
    await recordWith('12.34')
    expect(recordPaidFeeMock).toHaveBeenCalledWith('o1', 1234)
  })
})

// @vitest-environment happy-dom
// Orders.vue 钱链交互闸渲染回归（B9）：① clearFeeMismatch 是 Orders.vue 里唯一真实存在的「点一次=武装
// （按钮文案变确认态）、点两次才生效」toggle（clearConfirmId 驱动，见 doClearMismatch）；② shipOrder 本身
// 不是这种两步 toggle，而是「开抽屉填表单→点确认发货」一次性提交，闸门是公司/运单号必填校验（doShip）——
// 两条都测，覆盖两条真实存在的安全闸（主脑裁决：Orders.vue 无字面意义上「同一按钮点两下」的发货二次确认，
// 是否要仿 Products.vue 补一道另记 docs/待办与债.md flag，不在本批范围）。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const { listOrdersMock, orderCountsMock, getOrderDetailMock, shipOrderMock, shipOrdersMock, clearFeeMismatchMock } = vi.hoisted(() => ({
  listOrdersMock: vi.fn(),
  orderCountsMock: vi.fn(),
  getOrderDetailMock: vi.fn(),
  shipOrderMock: vi.fn(),
  shipOrdersMock: vi.fn(),
  clearFeeMismatchMock: vi.fn(),
}))
vi.mock('../src/api/money', () => ({
  listOrders: listOrdersMock,
  orderCounts: orderCountsMock,
  getOrderDetail: getOrderDetailMock,
  shipOrder: shipOrderMock,
  shipOrders: shipOrdersMock,
  clearFeeMismatch: clearFeeMismatchMock,
}))

import Orders from '../src/pages/Orders.vue'

function baseOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'o1',
    status: 'paid',
    items: [{ productId: 'p1', name: '钩织材料包', spec: '', qty: 1 }],
    amount: 9900,
    createdAt: Date.now(),
    feeMismatch: false,
    refundHold: false,
    address: { name: '张三', phone: '13800001111', region: '北京', detail: '朝阳区' },
    ...overrides,
  }
}

beforeEach(() => {
  orderCountsMock.mockReset().mockResolvedValue({ ok: true, counts: { paid: 1, all: 1 } })
  getOrderDetailMock.mockReset().mockResolvedValue({ ok: true, activations: {} })
  shipOrderMock.mockReset().mockResolvedValue({ ok: true })
  clearFeeMismatchMock.mockReset().mockResolvedValue({ ok: true })
})

describe('Orders.vue 金额异常单两步确认（clearFeeMismatch）', () => {
  it('大白话：第一次点「去核对」只武装不调用，第二次点「确认已核对流水？」才恰好调用一次 clearFeeMismatch(id)', async () => {
    listOrdersMock.mockReset().mockResolvedValue({
      ok: true,
      list: [baseOrder({ id: 'o1', feeMismatch: true })],
      nextCursor: null,
      hasMore: false,
    })
    const wrapper = mount(Orders)
    await flushPromises()

    const findMismatchBtn = () => wrapper.findAll('.ld-tr button').find((b) => b.text() === '去核对' || b.text() === '确认已核对流水？')
    const btn = findMismatchBtn()
    expect(btn).toBeTruthy()
    expect(btn!.text()).toBe('去核对')

    await btn!.trigger('click')
    await flushPromises()
    expect(clearFeeMismatchMock).not.toHaveBeenCalled()
    expect(findMismatchBtn()!.text()).toBe('确认已核对流水？')

    await findMismatchBtn()!.trigger('click')
    await flushPromises()
    expect(clearFeeMismatchMock).toHaveBeenCalledTimes(1)
    expect(clearFeeMismatchMock).toHaveBeenCalledWith('o1')
  })
})

describe('Orders.vue 发货表单校验闸（shipOrder）', () => {
  it('大白话：运单号留空点「确认发货」不触发 shipOrder 且提示必填，填齐才恰好调用一次 shipOrder(id, company, trackingNo)', async () => {
    listOrdersMock.mockReset().mockResolvedValue({
      ok: true,
      list: [baseOrder({ id: 'o2', status: 'paid' })],
      nextCursor: null,
      hasMore: false,
    })
    const wrapper = mount(Orders)
    await flushPromises()

    const shipBtn = wrapper.findAll('.ld-tr button').find((b) => b.text() === '发货')
    expect(shipBtn).toBeTruthy()
    await shipBtn!.trigger('click')
    await flushPromises()

    const confirmBtn = () => wrapper.findAll('.drawer button').find((b) => b.text().includes('确认发货'))
    expect(confirmBtn()).toBeTruthy()

    await confirmBtn()!.trigger('click')
    await flushPromises()
    expect(shipOrderMock).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('快递公司和运单号都要填')

    const trackingInput = wrapper.find('input[placeholder="扫描或输入运单号"]')
    expect(trackingInput.exists()).toBe(true)
    await trackingInput.setValue('SF1234567890')

    await confirmBtn()!.trigger('click')
    await flushPromises()
    expect(shipOrderMock).toHaveBeenCalledTimes(1)
    const calls = shipOrderMock.mock.calls
    expect(calls[0][0]).toBe('o2')
    expect(calls[0][2]).toBe('SF1234567890')
  })
})

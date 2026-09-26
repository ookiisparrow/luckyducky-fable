// @vitest-environment happy-dom
// Fulfill.vue doShip：成功提示里的物流公司必须是实际提交给 shipOrder 的那一个——在途期操作员改下拉框不许串台；
// 在途期再扫一枪要明说没生效（扫码枪连扫两箱时不吭声会让人以为已处理而漏发）。
import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const { listOrdersMock, shipOrderMock } = vi.hoisted(() => ({ listOrdersMock: vi.fn(), shipOrderMock: vi.fn() }))
vi.mock('../src/api/money', async (orig) => ({ ...(await orig<typeof import('../src/api/money')>()), listOrders: listOrdersMock }))
vi.mock('../src/api', () => ({ typedPost: shipOrderMock }))

import Fulfill from '../src/pages/Fulfill.vue'

const OID = '2026070413011234'

describe('Fulfill.vue 发货提示与实际提交的物流公司一致', () => {
  it('大白话：用顺丰发出后、回包前改选中通，提示仍写顺丰', async () => {
    localStorage.clear()
    listOrdersMock.mockResolvedValue({
      ok: true,
      list: [{ id: OID, status: 'paid', amount: 100, createdAt: Date.now(), items: [{ name: '小熊', qty: 1 }], address: { name: '张三' } }],
      hasMore: false,
    })
    let release: (v: unknown) => void = () => {}
    shipOrderMock.mockReturnValue(new Promise((r) => (release = r)))
    const w = mount(Fulfill)
    await flushPromises()
    await w.findAll('.rail-step')[2].trigger('click')
    await flushPromises()

    const sel = w.find('select.sel')
    await sel.setValue('顺丰速运')
    const scan = w.find('input.scan-input')
    await scan.setValue(OID)
    await scan.trigger('keyup.enter')
    await scan.setValue('SF1234567890')
    await scan.trigger('keyup.enter')
    expect(shipOrderMock).toHaveBeenCalledWith('shipOrder', { id: OID, company: '顺丰速运', trackingNo: 'SF1234567890', ackRefundedQty: {} })

    await sel.setValue('中通快递') // 在途改选
    release({ ok: true })
    await flushPromises()
    const msg = w.find('.scan-msg').text()
    expect(msg).toContain('已发货')
    expect(msg).toContain('顺丰速运')
    expect(msg).not.toContain('中通快递')
  })
})

describe('Fulfill.vue 发货在途再扫一枪', () => {
  it('大白话：上一单还没回包时再扫面单，不二发、提示这一枪没生效', async () => {
    localStorage.clear()
    listOrdersMock.mockResolvedValue({
      ok: true,
      list: [{ id: OID, status: 'paid', amount: 100, createdAt: Date.now(), items: [{ name: '小熊', qty: 1 }], address: { name: '张三' } }],
      hasMore: false,
    })
    shipOrderMock.mockReset().mockReturnValue(new Promise(() => {}))
    const w = mount(Fulfill)
    await flushPromises()
    await w.findAll('.rail-step')[2].trigger('click')
    await flushPromises()
    const scan = w.find('input.scan-input')
    await scan.setValue(OID)
    await scan.trigger('keyup.enter')
    await scan.setValue('SF1234567890')
    await scan.trigger('keyup.enter')
    await scan.setValue('SF0000000002')
    await scan.trigger('keyup.enter')
    expect(shipOrderMock).toHaveBeenCalledTimes(1)
    expect(w.find('.scan-msg').text()).toContain('上一单发货还在处理中')
    expect(w.find('.scan-msg').classes()).toContain('bad')
  })
})

describe('Fulfill.vue 页面自己处理数据时出错', () => {
  it('大白话：提示说中文、叫人刷新，不把英文异常原文甩给操作员；原文留控制台给技术', async () => {
    const boom = new TypeError("Cannot read properties of undefined (reading 'list')")
    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {})
    listOrdersMock.mockReset().mockRejectedValue(boom)
    const w = mount(Fulfill)
    await flushPromises()
    const err = w.find('.status-err').text()
    expect(err).toContain('加载失败')
    expect(err).not.toMatch(/[A-Za-z]/)
    expect(consoleErr).toHaveBeenCalledWith(boom)
    consoleErr.mockRestore()
  })
})

describe('Fulfill.vue 队列与发货失败的人话', () => {
  const order = (id: string, extra: Record<string, unknown> = {}) => ({ id, status: 'paid', amount: 100, createdAt: Date.now(), items: [{ name: '小熊', qty: 1 }], address: { name: '张三' }, ...extra })
  const toStep3 = async () => {
    const w = mount(Fulfill)
    await flushPromises()
    await w.findAll('.rail-step')[2].trigger('click')
    await flushPromises()
    return w
  }
  const shipWith = async (error: string) => {
    localStorage.clear()
    listOrdersMock.mockReset().mockResolvedValue({ ok: true, list: [order(OID)], hasMore: false })
    shipOrderMock.mockReset().mockResolvedValue({ ok: false, status: 400, error })
    const w = await toStep3()
    const scan = w.find('input.scan-input')
    await scan.setValue(OID)
    await scan.trigger('keyup.enter')
    await scan.setValue('SF1234567890')
    await scan.trigger('keyup.enter')
    await flushPromises()
    return w.find('.scan-msg').text()
  }

  it('大白话：待发货队列读失败说人话，不甩英文码', async () => {
    listOrdersMock.mockReset().mockResolvedValue({ ok: false, status: 0, error: 'NETWORK:fetch failed' })
    const w = mount(Fulfill)
    await flushPromises()
    expect(w.find('.status-err').text()).toBe('加载待发货订单失败：网络不通，请检查网络后重试。')
  })

  it('大白话：这单已发过货——指路去「订单发货」页改单号；别的失败走钱组同一套人话', async () => {
    expect(await shipWith('BAD_STATUS:shipped')).toBe('这单已发过货；要改运单号请去「订单发货」页')
    expect(await shipWith('FEE_MISMATCH_HOLD')).toBe('金额异常单被挡下：先去核对流水解除')
  })

  it('大白话：「剩几单待发」不算退款持有单（这些发不出去）', async () => {
    localStorage.clear()
    listOrdersMock.mockReset().mockResolvedValue({ ok: true, list: [order('o-ok'), order('o-hold', { refundHold: true })], hasMore: false })
    const w = await toStep3()
    expect(w.text()).toContain('剩 1 单待发 · 本次已发 0 单')
  })
})

// @vitest-environment happy-dom
// 发货工作台接上 listOrders 的每行已退件数：已退的件不进备货件数，核对卡明说「已退款，别发」；
// 扫码发货时把操作员看到的已退件数原样回传，服务端和现状对不上就拒。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const { listOrdersMock, postMock } = vi.hoisted(() => ({ listOrdersMock: vi.fn(), postMock: vi.fn() }))
vi.mock('../src/api/money', async (orig) => ({ ...(await orig<typeof import('../src/api/money')>()), listOrders: listOrdersMock }))
vi.mock('../src/api', () => ({ client: { post: postMock } }))
vi.mock('qrcode', () => ({ default: { toDataURL: async () => 'data:,' } }))

import Fulfill from '../src/pages/Fulfill.vue'

const OID = '2026070413011234'
const listWith = (refundedQty: Record<string, number>) =>
  listOrdersMock.mockResolvedValue({
    ok: true,
    list: [
      {
        id: OID,
        status: 'paid',
        amount: 140,
        createdAt: Date.now(),
        refundHold: false,
        refundedQty,
        items: [
          { productId: 'p1', lineId: 'p1__红', spec: '红', name: '小熊', qty: 1 },
          { productId: 'addon-yarn', lineId: 'addon-yarn__', spec: '', name: '线包', qty: 2 },
        ],
        address: { name: '张三' },
      },
    ],
    hasMore: false,
  })

async function scanToShip() {
  const w = mount(Fulfill)
  await flushPromises()
  await w.findAll('.rail-step')[2].trigger('click')
  await flushPromises()
  const scan = w.find('input.scan-input')
  await scan.setValue(OID)
  await scan.trigger('keyup.enter')
  await flushPromises()
  return w
}
async function scanTracking(w: any) {
  const scan = w.find('input.scan-input')
  await scan.setValue('SF1234567890')
  await scan.trigger('keyup.enter')
  await flushPromises()
}

beforeEach(() => {
  localStorage.clear()
  listOrdersMock.mockReset()
  postMock.mockReset()
})

describe('Fulfill.vue 部分退款单', () => {
  it('大白话：线包 2 件退了 1 件——备货算 2 件，核对卡照装线包 1 件、另 1 件别发；发货回传已退件数', async () => {
    listWith({ 'addon-yarn__': 1 })
    postMock.mockResolvedValue({ ok: true })
    const w = await scanToShip()
    expect(w.text()).toContain('共 2 件')
    expect(w.find('.check-card').text()).toContain('线包 × 1 已退款，别发')
    expect(w.findAll('.ck-line').map((x) => x.text())).toEqual(['小熊× 1', '线包× 1'])
    await scanTracking(w)
    expect(postMock).toHaveBeenCalledWith('shipOrder', {
      id: OID,
      company: expect.any(String),
      trackingNo: 'SF1234567890',
      ackRefundedQty: { 'addon-yarn__': 1 },
    })
  })

  it('大白话：对不上任何商品的已退记录不算「看到过」——不回传，让服务端拒发', async () => {
    listWith({ 'ghost__': 1 })
    postMock.mockResolvedValue({ ok: false, error: 'REFUND_LINES_CHANGED' })
    const w = await scanToShip()
    await scanTracking(w)
    expect(postMock.mock.calls[0][1].ackRefundedQty).toEqual({})
    expect(w.text()).toContain('打完标签后又有商品退款')
  })

  // 标签是打印那一刻印的：之后退了件、又刷新过队列，回传的仍须是标签上的件数，交给服务端对不上就拒
  async function printAll(w: any) {
    await w.findAll('.rail-step')[1].trigger('click')
    await flushPromises()
    const btn = w.findAll('button').find((b: any) => b.text().includes('张标签'))
    await btn.trigger('click')
    await flushPromises()
  }
  async function refreshAndScan(w: any) {
    await w.findAll('button').find((b: any) => b.text().includes('刷新队列')).trigger('click')
    await flushPromises()
    await w.findAll('.rail-step')[2].trigger('click')
    await flushPromises()
    const scan = w.find('input.scan-input')
    await scan.setValue(OID)
    await scan.trigger('keyup.enter')
    await flushPromises()
  }
  const fakeWin = () => vi.spyOn(window, 'open').mockReturnValue({ document: { write() {}, close() {} }, focus() {}, print() {} } as any)

  it('大白话：9 点印了线包×2，10 点退 1 件、刷新队列——扫码不发，提示标签作废去重打', async () => {
    fakeWin()
    listWith({})
    postMock.mockResolvedValue({ ok: false, error: 'REFUND_LINES_CHANGED' })
    const w = mount(Fulfill)
    await flushPromises()
    await printAll(w)
    listWith({ 'addon-yarn__': 1 })
    await refreshAndScan(w)
    expect(w.find('.scan-msg').text()).toContain('标签作废')
    await scanTracking(w)
    for (const [, body] of postMock.mock.calls) expect(body.ackRefundedQty).toEqual({}) // 发了也只带标签上的件数
  })

  it('大白话：标签作废的单回到第 2 步默认勾上重打；重打后按新件数发', async () => {
    fakeWin()
    listWith({})
    postMock.mockResolvedValue({ ok: true })
    const w = mount(Fulfill)
    await flushPromises()
    await printAll(w)
    listWith({ 'addon-yarn__': 1 })
    await w.findAll('button').find((b) => b.text().includes('刷新队列'))!.trigger('click')
    await flushPromises()
    await w.findAll('.rail-step')[1].trigger('click')
    await flushPromises()
    expect(w.find('.p-order input[type=checkbox]').element).toHaveProperty('checked', true)
    expect(w.find('.p-order').text()).toContain('标签作废')
    await printAll(w)
    await refreshAndScan(w)
    await scanTracking(w)
    expect(postMock).toHaveBeenCalledWith('shipOrder', expect.objectContaining({ ackRefundedQty: { 'addon-yarn__': 1 } }))
  })

  it('大白话：按提示刷新、重打、重装后回来直接扫面单（箱码还选着）——按新标签的件数发，不再被旧件数卡住', async () => {
    fakeWin()
    listWith({})
    postMock.mockResolvedValueOnce({ ok: false, error: 'REFUND_LINES_CHANGED' }).mockResolvedValue({ ok: true })
    const w = mount(Fulfill)
    await flushPromises()
    await printAll(w)
    listWith({ 'addon-yarn__': 1 }) // 服务端已退 1 件，页面还没刷新
    await w.findAll('.rail-step')[2].trigger('click')
    await flushPromises()
    const scan = w.find('input.scan-input')
    await scan.setValue(OID)
    await scan.trigger('keyup.enter')
    await scanTracking(w)
    expect(w.find('.scan-msg').text()).toContain('打完标签后又有商品退款')
    await w.findAll('button').find((b) => b.text().includes('刷新队列'))!.trigger('click')
    await flushPromises()
    await printAll(w)
    await w.findAll('.rail-step')[2].trigger('click')
    await flushPromises()
    await scanTracking(w)
    expect(postMock.mock.calls[1][1].ackRefundedQty).toEqual({ 'addon-yarn__': 1 })
  })
})

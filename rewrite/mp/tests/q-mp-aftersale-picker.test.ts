// 申请售后选择器：wx.showActionSheet 一屏最多 6 项，订单可退行超过 6 行时第 7 行起也得选得到。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { applyRefundMock } = vi.hoisted(() => ({ applyRefundMock: vi.fn() }))
vi.mock('../api/orders', () => ({
  pay: vi.fn(),
  getOrderById: vi.fn(),
  confirmReceive: vi.fn(),
  cancelOrder: vi.fn(),
  applyRefund: applyRefundMock,
  getMyAfterSales: async () => ({ ok: true, list: [], hasMore: false, nextCursor: null }),
}))
vi.mock('../lib/haptics', () => ({ tapHaptic: vi.fn() }))
vi.mock('../lib/nav', () => ({ navigateOrRedirect: vi.fn() }))

let wxMock: Record<string, any>
beforeEach(() => {
  applyRefundMock.mockReset()
  wxMock = { showToast: vi.fn(), showActionSheet: vi.fn(), showModal: vi.fn() }
  ;(globalThis as any).wx = wxMock
})

async function mount(lineCount: number): Promise<Record<string, any>> {
  let opts: Record<string, any> = {}
  ;(globalThis as any).Page = (o: Record<string, any>) => (opts = o)
  vi.resetModules()
  await import('../pages/order/order')
  const page = Object.create(opts) as Record<string, any>
  const items = Array.from({ length: lineCount }, (_, i) => ({ lineId: 'L' + (i + 1), name: '鸭' + (i + 1), spec: '', priceLabel: '', qty: 1, enteredQty: 0, refundable: true, cover: '' }))
  page.data = { ...opts.data, vm: { id: 'o1', status: 'done', items } }
  page.setData = function (patch: Record<string, unknown>) {
    Object.assign(this.data as Record<string, unknown>, patch)
  }
  return page
}

const sheet = (n: number) => wxMock.showActionSheet.mock.calls[n][0]

describe('售后选择器：超过 6 行也能选全', () => {
  it('大白话：8 行可退——第一屏 5 行加「更多…」，点更多翻到第 6-8 行，选第 7 行提交的就是第 7 行', async () => {
    applyRefundMock.mockResolvedValue({ ok: true })
    const page = await mount(8)
    await page.onAfterSale()
    expect(sheet(0).itemList).toHaveLength(6)
    expect(sheet(0).itemList.slice(0, 5)).toEqual(['鸭1', '鸭2', '鸭3', '鸭4', '鸭5'])
    sheet(0).success({ tapIndex: 5 })
    expect(sheet(1).itemList).toEqual(['鸭6', '鸭7', '鸭8'])
    sheet(1).success({ tapIndex: 1 })
    await wxMock.showModal.mock.calls[0][0].success({ confirm: true, content: '' })
    expect(applyRefundMock).toHaveBeenCalledWith('o1', 'L7', '')
  })

  it('大白话：刚好 6 行——一屏放得下，不加「更多…」', async () => {
    const page = await mount(6)
    await page.onAfterSale()
    expect(sheet(0).itemList).toEqual(['鸭1', '鸭2', '鸭3', '鸭4', '鸭5', '鸭6'])
  })

  it('大白话：12 行——翻三屏，最后一屏能选到第 12 行', async () => {
    applyRefundMock.mockResolvedValue({ ok: true })
    const page = await mount(12)
    await page.onAfterSale()
    sheet(0).success({ tapIndex: 5 })
    sheet(1).success({ tapIndex: 5 })
    expect(sheet(2).itemList).toEqual(['鸭11', '鸭12'])
    sheet(2).success({ tapIndex: 1 })
    await wxMock.showModal.mock.calls[0][0].success({ confirm: true, content: '' })
    expect(applyRefundMock).toHaveBeenCalledWith('o1', 'L12', '')
  })
})

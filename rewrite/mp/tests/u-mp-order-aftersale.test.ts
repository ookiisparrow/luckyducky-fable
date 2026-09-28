// 订单详情「申请售后」入口收窄：本单已申请过的行不该再出现在可选列表里。
// callApp 桩按云端 getMyAfterSales 的真实口径回包（本人售后按 appliedAt 倒序、按 limit 截断、缺省 100、上限 200），
// 这样 mp api 层的默认 limit 也在被测范围里。Page 桩同 me-cont-failed.test.ts。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { callAppMock } = vi.hoisted(() => ({ callAppMock: vi.fn() }))
vi.mock('../utils/cloud', () => ({ callApp: callAppMock }))
vi.mock('../lib/haptics', () => ({ tapHaptic: vi.fn() }))

let pageOpts: Record<string, any> = {}
;(globalThis as any).Page = (o: unknown) => {
  pageOpts = o as Record<string, any>
}

async function mount(): Promise<Record<string, any>> {
  vi.resetModules()
  await import('../pages/order/order')
  const page = Object.create(pageOpts) as Record<string, any>
  page.data = { ...pageOpts.data }
  page.setData = function (patch: Record<string, unknown>) {
    Object.assign(this.data as Record<string, unknown>, patch)
  }
  return page
}

const line = (lineId: string, name: string) => ({ lineId, name, spec: '', priceLabel: '', qty: 1, enteredQty: 0, refundable: true, cover: '' })
const VM = { id: 'o-old', status: 'done', items: [line('L1', '小鸭'), line('L2', '云朵鸭')] }

// 本人 25 条售后：最早一条是本单 L1，其余 24 条是别的订单、时间都更晚
const AFTER_SALES = [
  { _id: 'as-0', orderId: 'o-old', lineId: 'L1', appliedAt: 1000 },
  ...Array.from({ length: 24 }, (_, i) => ({ _id: 'as-' + (i + 1), orderId: 'o-' + (i + 1), lineId: 'X', appliedAt: 2000 + i })),
]

function cloudGetMyAfterSales(data: Record<string, unknown>) {
  const limit = Math.min(200, Math.max(1, Number(data.limit) || 100))
  const sorted = [...AFTER_SALES].sort((a, b) => b.appliedAt - a.appliedAt)
  return { ok: true, list: sorted.slice(0, limit), hasMore: sorted.length > limit, nextCursor: null }
}

let wxMock: Record<string, any>
beforeEach(() => {
  callAppMock.mockReset()
  wxMock = { showToast: vi.fn(), showActionSheet: vi.fn(), showModal: vi.fn() }
  ;(globalThis as any).wx = wxMock
})

describe('申请售后入口：已申请过的行要排除', () => {
  it('大白话：本人售后超过 20 条、本单那条申请得最早——它也得被认出来，不再出现在可选列表里', async () => {
    callAppMock.mockImplementation(async (action: string, data: Record<string, unknown>) =>
      action === 'getMyAfterSales' ? cloudGetMyAfterSales(data) : { ok: false, error: 'UNEXPECTED' }
    )
    const page = await mount()
    page.data.vm = VM
    await page.onAfterSale()
    expect(page.data.asOpen).toBe(true)
    expect(page.data.asLines.map((l: { label: string }) => l.label)).toEqual(['云朵鸭'])
  })

  it('大白话：售后记录拉取失败——不当成「一条都没申请过」把全部行摆出来，提示稍后再试', async () => {
    callAppMock.mockResolvedValue({ ok: false, error: 'CALL_TIMEOUT' })
    const page = await mount()
    page.data.vm = VM
    await page.onAfterSale()
    expect(page.data.asOpen).toBe(false)
    expect(wxMock.showToast).toHaveBeenCalledTimes(1)
    expect(wxMock.showToast.mock.calls[0][0].title).not.toBe('没有可申请售后的条目')
  })
})

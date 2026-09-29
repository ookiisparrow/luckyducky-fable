// 互跳页防叠栈（售后↔订单详情）：页面栈逼近微信 10 层上限（≥8）改 redirectTo 替换本页；
// 否则 navigateTo，失败降级 redirectTo（不静默卡死）。两个入口钉同一行为。Page 桩同 me-cont-failed.test.ts。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { callAppMock } = vi.hoisted(() => ({ callAppMock: vi.fn() }))
vi.mock('../utils/cloud', () => ({ callApp: callAppMock }))
vi.mock('../utils/customerService', () => ({ openCustomerService: vi.fn() }))
vi.mock('../lib/haptics', () => ({ tapHaptic: vi.fn() }))

let pageOpts: Record<string, any> = {}
;(globalThis as any).Page = (o: unknown) => {
  pageOpts = o as Record<string, any>
}

async function mount(path: string): Promise<Record<string, any>> {
  vi.resetModules()
  await import(path)
  const page = Object.create(pageOpts) as Record<string, any>
  page.data = { ...pageOpts.data }
  page.setData = function (patch: Record<string, unknown>) {
    Object.assign(this.data as Record<string, unknown>, patch)
  }
  return page
}

let wxMock: Record<string, any>
let depth = 1
beforeEach(() => {
  callAppMock.mockReset()
  depth = 1
  ;(globalThis as any).getCurrentPages = () => Array.from({ length: depth })
  wxMock = { redirectTo: vi.fn(), navigateTo: vi.fn(), showToast: vi.fn(), showActionSheet: vi.fn(), showModal: vi.fn(), showLoading: vi.fn(), hideLoading: vi.fn() }
  ;(globalThis as any).wx = wxMock
})

const tap = (id: string) => ({ currentTarget: { dataset: { id } } })

// 两个入口：各自触发一次跳转，返回期望的目标 url
const ENTRIES: Array<[string, () => Promise<string>]> = [
  [
    '我的售后 → 订单详情',
    async () => {
      const page = await mount('../pages/aftersales/aftersales')
      page.onTapOrder(tap('o1'))
      return '/pages/order/order?id=o1'
    },
  ],
  [
    '订单详情申请售后成功 → 我的售后',
    async () => {
      callAppMock.mockImplementation(async (action: string) =>
        action === 'getMyAfterSales' ? { ok: true, list: [], hasMore: false, nextCursor: null } : { ok: true }
      )
      const page = await mount('../pages/order/order')
      page.data.vm = { id: 'o1', status: 'done', items: [{ lineId: 'L1', name: '小鸭', spec: '', qty: 1, enteredQty: 0, refundable: true }] }
      await page.onAfterSale()
      await page.onAsSubmit()
      return '/pages/aftersales/aftersales'
    },
  ],
]

describe('互跳页防叠栈', () => {
  for (const [name, go] of ENTRIES) {
    it(`大白话：${name}——栈浅时 navigateTo 叠一层`, async () => {
      depth = 7
      const url = await go()
      expect(wxMock.navigateTo).toHaveBeenCalledTimes(1)
      expect(wxMock.navigateTo.mock.calls[0][0].url).toBe(url)
      expect(wxMock.redirectTo).not.toHaveBeenCalled()
    })

    it(`大白话：${name}——navigateTo 失败降级 redirectTo，不卡死`, async () => {
      depth = 2
      const url = await go()
      wxMock.navigateTo.mock.calls[0][0].fail()
      expect(wxMock.redirectTo).toHaveBeenCalledWith({ url })
    })

    it(`大白话：${name}——栈到 8 层改 redirectTo 替换本页，不再叠`, async () => {
      depth = 8
      const url = await go()
      expect(wxMock.navigateTo).not.toHaveBeenCalled()
      expect(wxMock.redirectTo).toHaveBeenCalledWith({ url })
    })
  }
})

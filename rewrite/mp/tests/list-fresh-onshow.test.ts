// 返回免重拉（性能批 #2·utils/fresh）：订单页 / 我的课程页刚拉过 30s 内再 onShow（从详情/物流/目录返回）不重拉；
// 期间做过写操作（api 层已标脏）回来必重拉。只桩云调用（callApp），页面/api/utils 都用真的。Page 桩同 p-mp-order-list-page.test.ts。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { callAppMock } = vi.hoisted(() => ({ callAppMock: vi.fn() }))
vi.mock('../utils/cloud', () => ({ callApp: callAppMock }))
vi.mock('../lib/haptics', () => ({ tapHaptic: vi.fn() }))

let pageOpts: Record<string, any> = {}
;(globalThis as any).Page = (o: unknown) => {
  pageOpts = o as Record<string, any>
}

async function mount(path: string): Promise<Record<string, any>> {
  vi.resetModules()
  await import(path)
  const page = Object.create(pageOpts) as Record<string, any>
  page.data = { ...pageOpts.data, shown: [] }
  page._all = []
  page.setData = function (patch: Record<string, unknown>) {
    Object.assign(this.data, patch)
  }
  if (typeof page.onLoad === 'function') page.onLoad({})
  return page
}
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}
const calls = (action: string) => callAppMock.mock.calls.filter((c) => c[0] === action).length

beforeEach(() => {
  const handlers: Record<string, () => unknown> = {
    getMyOrders: () => ({ ok: true, list: [], nextCursor: null, hasMore: false }),
    getMyAfterSales: () => ({ ok: true, list: [], nextCursor: null, hasMore: false }),
    getMyCourses: () => ({ ok: true, list: [] }),
    getCourses: () => ({ ok: true, list: [] }),
    getMyProgress: () => ({ ok: true, list: [] }),
  }
  callAppMock.mockReset().mockImplementation(async (action: string) => (handlers[action] ? handlers[action]() : { ok: false, error: 'UNEXPECTED' }))
  ;(globalThis as any).wx = { showToast: vi.fn(), navigateTo: vi.fn() }
})

describe('返回免重拉', () => {
  it('大白话：订单页——拉过一次后再 onShow 不重拉；有人（支付/取消…）把 orders 标脏后回来必重拉', async () => {
    const page = await mount('../pages/order-list/order-list')
    page.onShow()
    await flush()
    expect(calls('getMyOrders')).toBe(1)
    page.onHide()
    page.onShow() // 看了眼详情回来
    await flush()
    expect(calls('getMyOrders')).toBe(1)
    const { markStale } = await import('../utils/fresh') // resetModules 之后动态取，与页面拿到的是同一份
    markStale('orders')
    page.onHide()
    page.onShow()
    await flush()
    expect(calls('getMyOrders')).toBe(2)
    page.onHide()
  })

  it('大白话：我的课程页——同上；进度没拉到那次不算新鲜（下次 onShow 再拉）', async () => {
    const page = await mount('../pages/my-courses/my-courses')
    page.onShow()
    await flush()
    expect(calls('getMyCourses')).toBe(1)
    page.onShow()
    await flush()
    expect(calls('getMyCourses')).toBe(1)
    const { markStale } = await import('../utils/fresh')
    markStale('learning')
    page.onShow()
    await flush()
    expect(calls('getMyCourses')).toBe(2)
    // 进度读失败：列表照常渲染但不记新鲜，再 onShow 会重试
    callAppMock.mockImplementation(async (action: string) => (action === 'getMyProgress' ? { ok: false, error: 'CALL_TIMEOUT' } : { ok: true, list: [] }))
    markStale('learning')
    page.onShow()
    await flush()
    expect(calls('getMyCourses')).toBe(3)
    page.onShow()
    await flush()
    expect(calls('getMyCourses')).toBe(4)
  })
})

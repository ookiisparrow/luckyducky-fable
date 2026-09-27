// 订单列表翻页在途锁：上一页没回来又触底不重复请求同一游标；失败解锁可重拉；切 tab 后新列表的翻页不被旧请求拦住。
// 只桩云调用（callApp）。Page 桩同 p-mp-order-list-page.test.ts。
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
  await import('../pages/order-list/order-list')
  const page = Object.create(pageOpts) as Record<string, any>
  page.data = { ...pageOpts.data, shown: [] }
  page._all = []
  page.setData = function (patch: Record<string, unknown>) {
    for (const [k, v] of Object.entries(patch)) {
      const m = k.match(/^(\w+)\[(\d+)\]$/)
      if (m) (this.data as any)[m[1]][Number(m[2])] = v
      else (this.data as any)[k] = v
    }
  }
  page.onLoad({})
  return page
}

const order = (id: string) => ({ _id: id, status: 'pending', amount: 128, items: [{ lineId: 'L1', name: '小鸭', price: 64, qty: 2 }] })
const ids = (page: Record<string, any>) => page.data.shown.map((o: { id: string }) => o.id)
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}
const pageCalls = () => callAppMock.mock.calls.filter((c: any[]) => c[1].cursor != null)

let releases: Array<(v: unknown) => void>
beforeEach(() => {
  releases = []
  callAppMock.mockReset().mockImplementation(async (_a: string, d: Record<string, any>) =>
    d.cursor == null ? { ok: true, list: [order('o1')], nextCursor: 'c1', hasMore: true } : new Promise((r) => releases.push(r))
  )
  ;(globalThis as any).wx = { showToast: vi.fn(), showModal: vi.fn(), navigateTo: vi.fn() }
})

describe('订单列表：翻页在途锁', () => {
  it('大白话：上一页还没回来又触底——只发一次；失败后解锁，再触底能重拉', async () => {
    const page = await mount()
    await page.reload()
    const pending = [page.onReachBottom(), page.onReachBottom()]
    await flush()
    expect(pageCalls()).toHaveLength(1)
    releases.forEach((r) => r({ ok: false, error: 'CALL_FAIL' }))
    await Promise.all(pending)
    const again = page.onReachBottom()
    await flush()
    expect(pageCalls()).toHaveLength(2)
    releases[releases.length - 1]({ ok: true, list: [order('o2')], nextCursor: null, hasMore: false })
    await again
    expect(ids(page)).toEqual(['o1', 'o2'])
  })

  it('大白话：旧 tab 的翻页还挂着就切了 tab——新列表触底照常翻，不被旧请求拦住', async () => {
    const page = await mount()
    await page.reload()
    const stale = page.onReachBottom()
    await flush()
    page.onTab({ currentTarget: { dataset: { key: 'pending' } } })
    await flush()
    const fresh = page.onReachBottom()
    await flush()
    expect(pageCalls()).toHaveLength(2)
    releases.forEach((r) => r({ ok: true, list: [order('o9')], nextCursor: null, hasMore: false }))
    await Promise.all([stale, fresh])
  })
})

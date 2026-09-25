// 详情页加载：推荐取同一份全量表、排除本商品取 4 个；取数失败给重试，点重试先回到加载态。
// Page 桩同 me-cont-failed.test.ts。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { getAllMock } = vi.hoisted(() => ({ getAllMock: vi.fn() }))
vi.mock('../lib/catalog', () => ({ getAllProducts: getAllMock, getProductDetail: vi.fn().mockResolvedValue(null) }))
vi.mock('../api/learning', () => ({ trackEvent: vi.fn() }))
vi.mock('../api/reviews', () => ({ getRatingSummary: vi.fn().mockResolvedValue({ ok: false }) }))
vi.mock('../lib/cart', () => ({ add: vi.fn() }))
vi.mock('../lib/checkout', () => ({ prepareBuyNow: vi.fn() }))
vi.mock('../utils/customerService', () => ({ openCustomerService: vi.fn() }))
vi.mock('../lib/haptics', () => ({ tapHaptic: vi.fn() }))

let pageOpts: Record<string, any> = {}
;(globalThis as any).Page = (o: unknown) => {
  pageOpts = o as Record<string, any>
}

async function mount(): Promise<Record<string, any>> {
  vi.resetModules()
  await import('../pages/detail/detail')
  const page = Object.create(pageOpts) as Record<string, any>
  page.data = { ...pageOpts.data }
  page.setData = function (patch: Record<string, unknown>) {
    Object.assign(this.data as Record<string, unknown>, patch)
  }
  return page
}

const flush = () => new Promise((r) => setTimeout(r, 0))
const ALL = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].map((id) => ({ id, name: '鸭' + id, price: 10, cover: '' }))

beforeEach(() => {
  getAllMock.mockReset()
})

describe('详情页加载与推荐', () => {
  it('大白话：进页后渲染本商品，推荐是同一份全量表里排除本商品的前 4 个', async () => {
    getAllMock.mockResolvedValue(ALL)
    const page = await mount()
    page.onLoad({ id: 'p2' })
    await flush()
    expect(page.data.loading).toBe(false)
    expect(page.data.loadFailed).toBe(false)
    expect(page.data.vm.id).toBe('p2')
    expect(page.data.recs.map((p: { id: string }) => p.id)).toEqual(['p1', 'p3', 'p4', 'p5'])
  })

  it('大白话：取数失败亮重试；点重试立刻回到加载态，成功后正常渲染', async () => {
    getAllMock.mockResolvedValue(null)
    const page = await mount()
    page.onLoad({ id: 'p2' })
    await flush()
    expect(page.data).toMatchObject({ loading: false, loadFailed: true, vm: null })

    getAllMock.mockResolvedValue(ALL)
    page.onRetryLoad()
    expect(page.data).toMatchObject({ loading: true, loadFailed: false })
    await flush()
    expect(page.data).toMatchObject({ loading: false, loadFailed: false })
    expect(page.data.vm.id).toBe('p2')
    expect(page.data.recs).toHaveLength(4)
  })

  it('大白话：商品已下架（全量表里没有）→ 灭加载、不亮重试、不出推荐', async () => {
    getAllMock.mockResolvedValue(ALL)
    const page = await mount()
    page.onLoad({ id: 'gone' })
    await flush()
    expect(page.data).toMatchObject({ loading: false, loadFailed: false, vm: null })
    expect(page.data.recs).toEqual([])
  })
})

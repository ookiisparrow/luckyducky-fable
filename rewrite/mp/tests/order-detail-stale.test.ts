// 详情页评分摘要过期回包：连点重试 / 快速切商品时，上一趟的评分迟到回来不该盖到当前商品上。
// Page 桩同 me-cont-failed.test.ts。
import { describe, it, expect, vi } from 'vitest'

const { ratingMock } = vi.hoisted(() => ({ ratingMock: vi.fn() }))
vi.mock('../api/reviews', () => ({ getRatingSummary: ratingMock }))
vi.mock('../api/learning', () => ({ trackEvent: vi.fn() }))
vi.mock('../lib/catalog', () => ({ getAllProducts: vi.fn(), getProductDetail: vi.fn() }))
vi.mock('../lib/cart', () => ({ add: vi.fn() }))
vi.mock('../lib/checkout', () => ({ prepareBuyNow: vi.fn() }))
vi.mock('../utils/customerService', () => ({ openCustomerService: vi.fn() }))
vi.mock('../lib/haptics', () => ({ tapHaptic: vi.fn() }))

let pageOpts: Record<string, any> = {}
;(globalThis as any).Page = (o: unknown) => {
  pageOpts = o as Record<string, any>
}

describe('详情评分摘要过期回包', () => {
  it('大白话：评分回包若这一趟已经过期（期间又加载了一次），就丢掉不写；当前这趟的照常写', async () => {
    vi.resetModules()
    await import('../pages/detail/detail')
    const page = Object.create(pageOpts) as Record<string, any>
    page.data = { ...pageOpts.data }
    page.setData = function (patch: Record<string, unknown>) {
      Object.assign(this.data as Record<string, unknown>, patch)
    }

    let releaseOld!: (v: unknown) => void
    ratingMock.mockReturnValueOnce(new Promise((r) => (releaseOld = r)))
    page._seq = 1
    const old = page.loadRating('p-old', 1)
    page._seq = 2 // 又加载了一次商品
    releaseOld({ ok: true, count: 9, score: 4.2 })
    await old
    expect(page.data.rating).toBeNull()

    ratingMock.mockResolvedValueOnce({ ok: true, count: 3, score: 5 })
    await page.loadRating('p-new', 2)
    expect(page.data.rating).toMatchObject({ count: 3, scoreLabel: '5' })
  })
})

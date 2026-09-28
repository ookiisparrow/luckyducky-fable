// 详情页加购/直买的成交行：选中规格的名与价随行；商品级划线价不高于现价（规格价）就不透传——
// 否则购物车行会渲染「划线 ¥158 < 现价 ¥198」（cart.wxml wx:if="{{item.was}}" 直渲），同 lib/quickAdd 那道闸。
// Page 桩同 me-cont-failed.test.ts。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { addMock, trackMock, buyNowMock } = vi.hoisted(() => ({ addMock: vi.fn(), trackMock: vi.fn(), buyNowMock: vi.fn() }))
vi.mock('../lib/cart', () => ({ add: addMock }))
vi.mock('../api/learning', () => ({ trackEvent: trackMock }))
vi.mock('../lib/checkout', () => ({ prepareBuyNow: buyNowMock }))
vi.mock('../lib/catalog', () => ({ getAllProducts: vi.fn(), getProductDetail: vi.fn() }))
vi.mock('../api/reviews', () => ({ getRatingSummary: vi.fn() }))
vi.mock('../utils/customerService', () => ({ openCustomerService: vi.fn() }))
vi.mock('../lib/haptics', () => ({ tapHaptic: vi.fn() }))

let pageOpts: Record<string, any> = {}
;(globalThis as any).Page = (o: unknown) => {
  pageOpts = o as Record<string, any>
}

async function mount(vm: Record<string, unknown>, skuIndex: number): Promise<Record<string, any>> {
  vi.resetModules()
  await import('../pages/detail/detail')
  const page = Object.create(pageOpts) as Record<string, any>
  page.data = { ...pageOpts.data, vm, skuIndex }
  return page
}

const VM = {
  id: 'p1',
  name: '小鸭',
  tag: '热卖',
  price: 128,
  was: 158,
  gallery: ['cloud://c1', 'cloud://c2'],
  skus: [
    { name: '大号', price: 198 },
    { name: '小号', price: 98 },
  ],
}

beforeEach(() => {
  addMock.mockReset()
  trackMock.mockReset()
  buyNowMock.mockReset()
  ;(globalThis as any).wx = { showToast: vi.fn(), navigateTo: vi.fn() }
})

describe('详情页加购：划线价不高于现价不透传', () => {
  it('大白话：选的规格比划线价还贵（198 ≥ 158）——入车不带划线价', async () => {
    const page = await mount(VM, 0)
    page.onAddCart()
    expect(addMock).toHaveBeenCalledTimes(1)
    expect(addMock.mock.calls[0][0]).toMatchObject({ id: 'p1', sku: '大号', name: '小鸭', tag: '热卖', price: 198, cover: 'cloud://c1' })
    expect(addMock.mock.calls[0][0].was).toBeUndefined()
    expect(trackMock).toHaveBeenCalledWith('add_to_cart', 'detail', 'p1', { sku: '大号', price: 198 })
  })

  it('大白话：选的规格比划线价便宜（98 < 158）——划线价照常带上', async () => {
    const page = await mount(VM, 1)
    page.onAddCart()
    expect(addMock.mock.calls[0][0]).toMatchObject({ sku: '小号', price: 98, was: 158 })
    expect(trackMock).toHaveBeenCalledWith('add_to_cart', 'detail', 'p1', { sku: '小号', price: 98 })
  })

  it('大白话：没有规格——用商品价、规格名空，划线价高于商品价照常带上', async () => {
    const page = await mount({ ...VM, skus: [] }, -1)
    page.onAddCart()
    expect(addMock.mock.calls[0][0]).toMatchObject({ sku: '', price: 128, was: 158 })
  })

  it('大白话：立即购买拿到的规格/价格/封面与加购同源，直买不动购物车', async () => {
    const page = await mount(VM, 0)
    page.onBuyNow()
    expect(addMock).not.toHaveBeenCalled()
    expect(buyNowMock).toHaveBeenCalledTimes(1)
    expect(buyNowMock.mock.calls[0][0]).toMatchObject({ id: 'p1', sku: '大号', name: '小鸭', tag: '热卖', price: 198, cover: 'cloud://c1' })
  })
})

describe('详情页切款式', () => {
  it('大白话：翻到第 2 张图再换款式——价格跟着变，图集回到第 1 张（swiper current 绑 galleryIndex，平滑滑回）', async () => {
    const page = await mount(VM, 0)
    page.data.galleryIndex = 1
    page.setData = function (patch: Record<string, unknown>) {
      Object.assign(this.data as Record<string, unknown>, patch)
    }
    page.onSelectSku({ currentTarget: { dataset: { index: 1 } } })
    expect(page.data.skuIndex).toBe(1)
    expect(page.data.currentPriceNum).toBe(98)
    expect(page.data.galleryIndex).toBe(0)
    expect(page.data.galleryWindow).toEqual([true, true])
  })
})

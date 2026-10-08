// 购物车 tab 切回（onShow）：refresh() 同步重画列表并在末尾同步 tabBar 角标——onShow 不必自己再调一次
// setActive（多一次 tabBar setData + 一次购物车计数）。Page 桩同 me-cont-failed.test.ts。
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../api/learning', () => ({ trackEvent: vi.fn() }))
vi.mock('../lib/haptics', () => ({ tapHaptic: vi.fn() }))
vi.mock('../lib/checkout', () => ({ prepareFromCart: vi.fn() }))
vi.mock('../lib/catalog', () => ({ getAllProducts: vi.fn() }))
vi.mock('../lib/homeIntent', () => ({ goHomeTab: vi.fn() }))
vi.mock('../utils/exitGuard', () => ({ armExitGuard: vi.fn(), releaseExitGuard: vi.fn(), onExitGuardBeforeLeave: vi.fn() }))
vi.mock('../lib/cart', () => ({
  getItems: () => [{ id: 'p1', sku: '', name: '小鸭', price: 128, qty: 2, selected: true, cover: '' }],
  selectedCount: () => 2,
  selectedTotalLabel: () => '¥256.00',
  freshCover: (it: { cover: string }) => it.cover,
  syncPrices: () => false,
}))

let pageOpts: Record<string, any> = {}
;(globalThis as any).Page = (o: unknown) => {
  pageOpts = o as Record<string, any>
}

const setActive = vi.fn()
async function mount(): Promise<Record<string, any>> {
  vi.resetModules()
  await import('../pages/cart/cart')
  const page = Object.create(pageOpts) as Record<string, any>
  page.data = { ...pageOpts.data, items: [], selectedCount: 0 }
  page.setData = function (patch: Record<string, unknown>) {
    Object.assign(this.data as Record<string, unknown>, patch)
  }
  page.getTabBar = () => ({ setActive })
  return page
}

beforeEach(() => {
  setActive.mockReset()
  ;(globalThis as any).wx = {}
})

describe('购物车 onShow', () => {
  it('大白话：切回购物车——列表重画、角标同步一次（不重复同步）', async () => {
    const page = await mount()
    page.onShow()
    expect(page.data.items).toHaveLength(1)
    expect(page.data.selectedCount).toBe(2)
    expect(page.data.totalLabel).toBe('¥256.00')
    expect(setActive).toHaveBeenCalledWith('cart')
    expect(setActive).toHaveBeenCalledTimes(1)
  })

  it('大白话：云目录首拉还没回来就切回购物车——也先把本地车刷出来（不等云目录）', async () => {
    const page = await mount()
    const { getAllProducts } = await import('../lib/catalog')
    vi.mocked(getAllProducts).mockReturnValue(new Promise<never>(() => {})) // 云目录首拉一直不回
    ;(globalThis as any).wx = { getWindowInfo: () => ({ statusBarHeight: 20 }) }
    void page.onLoad() // 卡在等云目录
    expect(page.data.items).toHaveLength(1) // 进页即上屏本地车
    page.data.items = []
    page.onShow()
    expect(page.data.items).toHaveLength(1) // 切回也不等云目录
    expect(setActive).toHaveBeenCalledWith('cart')
  })
})

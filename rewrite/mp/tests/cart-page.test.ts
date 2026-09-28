// 购物车页（v5 A4）：小货车箱数跟「已勾选」行数走（最多 3 箱）；按住删除成功提示「已删除」、松手太快提示「按住删除」、
// 没勾选点结算提示「先勾选要买的宝贝」——三句都走自绘提示（fxHint；测试桩没挂 px-fx，落回原生无图标提示）。
// 购物车 lib 用真的（wx 存储桩），其余依赖桩掉。Page 桩同 u-mp-cart-onshow.test.ts。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../api/learning', () => ({ trackEvent: vi.fn() }))
vi.mock('../lib/haptics', () => ({ tapHaptic: vi.fn(), keyHaptic: vi.fn() }))
vi.mock('../lib/checkout', () => ({ prepareFromCart: vi.fn() }))
vi.mock('../lib/catalog', () => ({ getAllProducts: vi.fn(async () => []) }))
vi.mock('../lib/homeIntent', () => ({ goHomeTab: vi.fn() }))
vi.mock('../utils/exitGuard', () => ({ armExitGuard: vi.fn(), releaseExitGuard: vi.fn(), onExitGuardBeforeLeave: vi.fn() }))

let storage: Record<string, unknown>
let wxMock: Record<string, any>
let cart: typeof import('../lib/cart')

async function mount(): Promise<Record<string, any>> {
  let opts: Record<string, any> = {}
  ;(globalThis as any).Page = (o: Record<string, any>) => (opts = o)
  vi.resetModules()
  cart = await import('../lib/cart')
  for (const id of ['p1', 'p2', 'p3', 'p4']) cart.add({ id, name: '鸭' + id, price: 10 })
  cart.toggle('p3')
  cart.toggle('p4') // 4 行里勾 2 行
  await import('../pages/cart/cart')
  const page = Object.create(opts) as Record<string, any>
  page.data = { ...opts.data }
  page.setData = function (patch: Record<string, unknown>) {
    Object.assign(this.data as Record<string, unknown>, patch)
  }
  page.refresh()
  return page
}

const row = (id: string) => ({ currentTarget: { dataset: { id, sku: '', line: id + '__' } } })

beforeEach(() => {
  storage = {}
  wxMock = {
    getStorageSync: (k: string) => storage[k],
    setStorageSync: (k: string, v: unknown) => (storage[k] = JSON.parse(JSON.stringify(v))),
    getWindowInfo: () => ({ statusBarHeight: 20 }),
    showToast: vi.fn(),
    navigateTo: vi.fn(),
  }
  ;(globalThis as any).wx = wxMock
})
afterEach(() => vi.useRealTimers())

describe('购物车：小货车箱数', () => {
  it('大白话：车斗箱数＝勾了几行（最多 3 箱），不是车里一共几行；勾/取消勾随时跟着变', async () => {
    const page = await mount()
    expect(page.data.cargo).toBe(2)
    page.onToggle(row('p1'))
    expect(page.data.cargo).toBe(1)
    for (const id of ['p1', 'p3', 'p4']) page.onToggle(row(id))
    expect(page.data.cargo).toBe(3) // 勾满 4 行也只装 3 箱
  })
})

describe('购物车：按住删除', () => {
  it('大白话：按满 0.6 秒删掉这行并提示「已删除」；松手太快不删、提示「按住删除」', async () => {
    vi.useFakeTimers()
    const page = await mount()
    page.onHoldStart(row('p2'))
    vi.advanceTimersByTime(100)
    page.onHoldEnd()
    expect(wxMock.showToast).toHaveBeenLastCalledWith({ title: '按住删除', icon: 'none' })
    expect(page.data.items).toHaveLength(4)

    page.onHoldStart(row('p2'))
    vi.advanceTimersByTime(600)
    expect(page.data.items.map((it: any) => it.id)).toEqual(['p1', 'p3', 'p4'])
    expect(wxMock.showToast).toHaveBeenLastCalledWith({ title: '已删除', icon: 'none' })
  })
})

describe('购物车：没勾选点结算', () => {
  it('大白话：一行都没勾——提示「先勾选要买的宝贝」，不去结算页', async () => {
    const page = await mount()
    page.onToggle(row('p1'))
    page.onToggle(row('p2'))
    page.onCheckout()
    expect(wxMock.showToast).toHaveBeenCalledWith({ title: '先勾选要买的宝贝', icon: 'none' })
    expect(wxMock.navigateTo).not.toHaveBeenCalled()
  })
})

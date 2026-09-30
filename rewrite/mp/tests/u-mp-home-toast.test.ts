// 首页轻提示与跳转（v5 第 3 轮）：「+」加购走 px-fx 设计稿提示（像素 ✓ + 0.94 出场），不再用页内自绘 ping；
// 加购只弹提示（v6 Lite 底栏不显示件数·不再碰 tab bar）；tab bar 重复点「首页」平滑回顶；页脚店名进关于页；「购买」没有小棉鸭时占位第一件商品。
// Page 桩同 me-cont-failed.test.ts。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BRAND_NAME } from '../lib/brand'

const { byIdMock, addMock } = vi.hoisted(() => ({ byIdMock: vi.fn(), addMock: vi.fn() }))
vi.mock('../api/learning', () => ({ trackEvent: vi.fn() }))
vi.mock('../api/catalog', () => ({ getContent: vi.fn() }))
vi.mock('../lib/catalog', () => ({ getAllProducts: vi.fn(), getProductById: byIdMock }))
vi.mock('../lib/cart', () => ({ add: addMock }))
vi.mock('../lib/loginGate', () => ({ loginGate: { maybePromptOnce: vi.fn() } }))
vi.mock('../lib/snapshot', () => ({ readSnapshot: vi.fn(), writeSnapshot: vi.fn() }))
vi.mock('../lib/coldStart', () => ({ reportColdStart: vi.fn() }))
vi.mock('../lib/haptics', () => ({ tapHaptic: vi.fn() }))
vi.mock('../utils/exitGuard', () => ({ armExitGuard: vi.fn(), releaseExitGuard: vi.fn(), onExitGuardBeforeLeave: vi.fn() }))

let pageOpts: Record<string, any> = {}
;(globalThis as any).Page = (o: unknown) => {
  pageOpts = o as Record<string, any>
}

const fx = { toast: vi.fn() }
const tabBar = { setActive: vi.fn(), bump: vi.fn() }

async function mount(withFx = true): Promise<Record<string, any>> {
  vi.resetModules()
  await import('../pages/home/home')
  const page = Object.create(pageOpts) as Record<string, any>
  page.data = { ...pageOpts.data }
  page.setData = function (patch: Record<string, unknown>, cb?: () => void) {
    Object.assign(this.data as Record<string, unknown>, patch)
    cb?.()
  }
  page.selectComponent = (sel: string) => (withFx && sel === '#fx' ? fx : null)
  page.getTabBar = () => tabBar
  return page
}

const tapId = (id: string) => ({ currentTarget: { dataset: { id } } })

beforeEach(() => {
  fx.toast.mockReset()
  tabBar.setActive.mockReset()
  tabBar.bump.mockReset()
  addMock.mockReset()
  byIdMock.mockReset()
  ;(globalThis as any).wx = { navigateTo: vi.fn(), showToast: vi.fn() }
})

describe('首页「+」加购提示', () => {
  it('大白话：加购成功——设计稿带 ✓ 的提示（多规格带上规格名）；底栏不显示件数，不再碰 tab bar', async () => {
    byIdMock.mockResolvedValue({ id: 'p1', name: '小鸭', price: 128, skus: [{ name: '鹅黄', price: 128 }, { name: '浅粉', price: 128 }] })
    const page = await mount()
    await page.onAddProduct(tapId('p1'))
    expect(addMock).toHaveBeenCalledTimes(1)
    expect(fx.toast).toHaveBeenCalledWith('已加入购物车 · 鹅黄', true, undefined, undefined)
    expect(tabBar.bump).not.toHaveBeenCalled()
    expect(tabBar.setActive).not.toHaveBeenCalled()
  })

  it('大白话：商品信息取不到——不带 ✓ 的普通提示', async () => {
    byIdMock.mockResolvedValue(null)
    const page = await mount()
    await page.onAddProduct(tapId('p1'))
    expect(fx.toast).toHaveBeenCalledWith('商品信息获取失败，请稍后重试', false, undefined, undefined)
    expect(tabBar.bump).not.toHaveBeenCalled()
  })

  it('大白话：tab bar 只有 setActive 也照常加购', async () => {
    byIdMock.mockResolvedValue({ id: 'p1', name: '小鸭', price: 128 })
    const page = await mount()
    page.getTabBar = () => ({ setActive: vi.fn() })
    await page.onAddProduct(tapId('p1'))
    expect(fx.toast).toHaveBeenCalledWith('已加入购物车', true, undefined, undefined)
  })
})

describe('首页「+」连点（UX 修复）', () => {
  it('大白话：冷启动时连点两下「+」（商品数据还在路上）——两下都加进购物车，只提示一次', async () => {
    let release!: (v: unknown) => void
    const pending = new Promise((r) => (release = r))
    byIdMock.mockReturnValue(pending)
    const page = await mount()
    const a = page.onAddProduct(tapId('p1'))
    const b = page.onAddProduct(tapId('p1'))
    release({ id: 'p1', name: '小鸭', price: 128 })
    await Promise.all([a, b])
    expect(addMock).toHaveBeenCalledTimes(2)
    expect(fx.toast).toHaveBeenCalledTimes(1)
  })
})

describe('首页跳转防连点（UX 修复）', () => {
  it('大白话：收尾大键撒花期间连点——只进一次详情', async () => {
    vi.useFakeTimers()
    try {
      const page = await mount(false)
      page.data.products = [{ id: 'yarn', name: '补充棉线', tag: '', priceLabel: '¥29', wasLabel: '', cover: '' }]
      page.toProducts()
      page.toProducts()
      vi.advanceTimersByTime(300)
      expect((globalThis as any).wx.navigateTo).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('大白话：商品卡连点两下——只进一次详情；过一会儿（或从详情回来）能再点', async () => {
    vi.useFakeTimers()
    try {
      const page = await mount()
      page.onTapProduct(tapId('p1'))
      page.onTapProduct(tapId('p1'))
      expect((globalThis as any).wx.navigateTo).toHaveBeenCalledTimes(1)
      vi.advanceTimersByTime(900)
      page.onTapProduct(tapId('p1'))
      expect((globalThis as any).wx.navigateTo).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('首页跳转', () => {
  it('大白话：tab bar 上再点一次「首页」——平滑滚回顶部', async () => {
    const page = await mount()
    page.onTabReselect()
    expect(page.data.scrollInto).toBe('top')
    expect(page.data.scrollAnim).toBe(true)
  })

  it('大白话：页脚店名链接进关于页；别的链接提示敬请期待', async () => {
    const page = await mount()
    page.onTapFooterLink({ currentTarget: { dataset: { label: BRAND_NAME } } })
    expect((globalThis as any).wx.navigateTo).toHaveBeenCalledWith({ url: '/pages/about/about' })
    page.onTapFooterLink({ currentTarget: { dataset: { label: '加入我们' } } })
    expect(fx.toast).toHaveBeenCalledWith('加入我们 · 敬请期待', false, undefined, undefined)
  })

  it('大白话：「购买」——货架还没有小棉鸭就进第一件商品详情占位（拍板 18），不再滚到商品区', async () => {
    const page = await mount(false) // 没特效层：转场直接放行跳转
    page.data.products = [{ id: 'yarn', name: '补充棉线', tag: '', priceLabel: '¥29', wasLabel: '', cover: '' }]
    await page.toProductsTop()
    expect((globalThis as any).wx.navigateTo).toHaveBeenCalledWith({ url: '/pages/detail/detail?id=yarn' })
  })
})

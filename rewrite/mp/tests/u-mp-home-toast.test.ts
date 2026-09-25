// 首页自绘 toast（ping）：1.6s 内切走本页（切 tab / 点商品卡进详情），onHide 清掉了收起定时器，
// toast 也必须一起收起——wxss .ld-toast.show 是 opacity:1、没有自动淡出，不收就一直挂在屏幕中央等下一次 ping。
// Page 桩同 me-cont-failed.test.ts。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../api/learning', () => ({ trackEvent: vi.fn() }))
vi.mock('../api/catalog', () => ({ getContent: vi.fn() }))
vi.mock('../lib/catalog', () => ({ getAllProducts: vi.fn(), getProductById: vi.fn() }))
vi.mock('../lib/loginGate', () => ({ loginGate: { maybePromptOnce: vi.fn() } }))
vi.mock('../lib/snapshot', () => ({ readSnapshot: vi.fn(), writeSnapshot: vi.fn() }))
vi.mock('../lib/coldStart', () => ({ reportColdStart: vi.fn() }))
vi.mock('../utils/exitGuard', () => ({ armExitGuard: vi.fn(), releaseExitGuard: vi.fn(), onExitGuardBeforeLeave: vi.fn() }))

let pageOpts: Record<string, any> = {}
;(globalThis as any).Page = (o: unknown) => {
  pageOpts = o as Record<string, any>
}

async function mount(): Promise<Record<string, any>> {
  vi.resetModules()
  await import('../pages/home/home')
  const page = Object.create(pageOpts) as Record<string, any>
  page.data = { ...pageOpts.data, toast: { show: false, text: '' } }
  page.setData = function (patch: Record<string, unknown>) {
    for (const [k, v] of Object.entries(patch)) {
      if (k === 'toast.show') this.data.toast = { ...this.data.toast, show: v }
      else this.data[k] = v
    }
  }
  return page
}

beforeEach(() => {
  vi.useFakeTimers()
  ;(globalThis as any).wx = {}
})
afterEach(() => {
  vi.useRealTimers()
})

describe('首页 toast 切走即收起', () => {
  it('大白话：toast 亮着时切到别的 tab（onHide）——toast 收起，回来不会一直挂着', async () => {
    const page = await mount()
    page.ping('已加入购物车')
    expect(page.data.toast.show).toBe(true)
    page.onHide()
    expect(page.data.toast.show).toBe(false)
  })

  it('大白话：toast 亮着时页面卸载（onUnload）——同样收起', async () => {
    const page = await mount()
    page.ping('已加入购物车')
    page.onUnload()
    expect(page.data.toast.show).toBe(false)
  })

  it('大白话：不切走就照常 1.6 秒后自动收起', async () => {
    const page = await mount()
    page.ping('已加入购物车')
    vi.advanceTimersByTime(1599)
    expect(page.data.toast.show).toBe(true)
    vi.advanceTimersByTime(1)
    expect(page.data.toast.show).toBe(false)
  })
})

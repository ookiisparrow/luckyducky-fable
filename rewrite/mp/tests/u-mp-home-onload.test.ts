// 首页 onLoad：有首屏快照 → 同步渲染快照内容并放行开屏；无快照 → 保持加载态等 reload。两种都立刻发起 reload。
// Page 桩同 me-cont-failed.test.ts。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { readSnapshotMock, getContentMock } = vi.hoisted(() => ({ readSnapshotMock: vi.fn(), getContentMock: vi.fn() }))
vi.mock('../api/learning', () => ({ trackEvent: vi.fn() }))
vi.mock('../api/catalog', () => ({ getContent: getContentMock }))
vi.mock('../lib/catalog', () => ({ getAllProducts: vi.fn(() => new Promise(() => undefined)), getProductById: vi.fn() }))
vi.mock('../lib/loginGate', () => ({ loginGate: { maybePromptOnce: vi.fn() } }))
vi.mock('../lib/snapshot', () => ({ readSnapshot: readSnapshotMock, writeSnapshot: vi.fn() }))
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
  page.data = { ...pageOpts.data }
  page.setData = function (patch: Record<string, unknown>) {
    Object.assign(this.data as Record<string, unknown>, patch)
  }
  return page
}

beforeEach(() => {
  ;(globalThis as any).wx = { getWindowInfo: () => ({ statusBarHeight: 33 }) }
  readSnapshotMock.mockReset()
  getContentMock.mockReset().mockReturnValue(new Promise(() => undefined)) // reload 挂起：只看 onLoad 同步落的态
})

describe('首页 onLoad 首屏快照', () => {
  it('大白话：有快照 → 状态栏高度与快照内容同步到位、灭加载、放行开屏', async () => {
    readSnapshotMock.mockReturnValue({ v: 1, savedAt: 0, home: null, products: [{ id: 'p1', name: '鸭', tag: '', price: 10, was: null, cover: '' }] })
    const page = await mount()
    page.onLoad()
    expect(page.data).toMatchObject({ statusBarHeight: 33, loading: false, splashReady: true })
    expect(page.data.products.map((p: { id: string }) => p.id)).toEqual(['p1'])
    expect(page._hadSnapshot).toBe(true)
    expect(getContentMock).toHaveBeenCalledTimes(1)
  })

  it('大白话：无快照 → 只落状态栏高度，保持加载态、开屏不放行，等 reload', async () => {
    readSnapshotMock.mockReturnValue(null)
    const page = await mount()
    page.onLoad()
    expect(page.data).toMatchObject({ statusBarHeight: 33, loading: true, splashReady: false, products: [] })
    expect(page._hadSnapshot).toBe(false)
    expect(getContentMock).toHaveBeenCalledTimes(1)
  })
})

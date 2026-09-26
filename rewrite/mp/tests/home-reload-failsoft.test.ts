// G1（P1·bug）home.reload() 强刷商品失败（getAllProducts 返 null）不能把已渲染的商品轨清空成「上新在路上」；
// 失败态只在没有快照垫底时出面。Page 桩同 me-cont-failed.test.ts。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { readSnapshotMock, getContentMock, getAllMock } = vi.hoisted(() => ({ readSnapshotMock: vi.fn(), getContentMock: vi.fn(), getAllMock: vi.fn() }))
vi.mock('../api/learning', () => ({ trackEvent: vi.fn() }))
vi.mock('../api/catalog', () => ({ getContent: getContentMock }))
vi.mock('../lib/catalog', () => ({ getAllProducts: getAllMock, getProductById: vi.fn() }))
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

const RAW = [{ id: 'p1', name: '小鸭', price: 128, cover: '' }]
const ids = (page: Record<string, any>) => page.data.products.map((p: { id: string }) => p.id)

beforeEach(() => {
  ;(globalThis as any).wx = { getWindowInfo: () => ({ statusBarHeight: 20 }) }
  readSnapshotMock.mockReset().mockReturnValue(null)
  getContentMock.mockReset().mockResolvedValue({ ok: false })
  getAllMock.mockReset()
})

describe('home.reload() 商品强刷失败 fail-soft（G1）', () => {
  it('大白话：已经画出商品，这次强刷失败——商品轨原样保留，不清成空', async () => {
    getAllMock.mockResolvedValueOnce(RAW)
    const page = await mount()
    await page.reload()
    expect(ids(page)).toEqual(['p1'])
    getAllMock.mockResolvedValueOnce(null)
    await page.reload()
    expect(ids(page)).toEqual(['p1'])
    expect(page.data.loading).toBe(false)
  })

  it('大白话：有快照垫底时强刷失败不翻失败态；没快照时才亮失败态', async () => {
    readSnapshotMock.mockReturnValue({ v: 1, savedAt: 0, home: null, products: RAW })
    getAllMock.mockResolvedValue(null)
    const withSnap = await mount()
    withSnap.onLoad()
    await withSnap.reload()
    expect(withSnap.data.loadFailed).toBe(false)
    expect(ids(withSnap)).toEqual(['p1'])

    readSnapshotMock.mockReturnValue(null)
    const cold = await mount()
    cold.onLoad()
    await cold.reload()
    expect(cold.data.loadFailed).toBe(true)
  })

  it('大白话：强刷成功照常换上新商品、灭失败态', async () => {
    getAllMock.mockResolvedValue([...RAW, { id: 'p2', name: '云朵鸭', price: 22, cover: '' }])
    const page = await mount()
    await page.reload()
    expect(ids(page)).toEqual(['p1', 'p2'])
    expect(page.data.loadFailed).toBe(false)
  })
})

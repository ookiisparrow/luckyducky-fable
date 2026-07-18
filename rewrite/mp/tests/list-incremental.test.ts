// 钱链后回访高频页（order-list / reviews）批4 守卫（根因#7 规模 + #8 感知等待）：
//   ① 骨架屏：加载中且列表空时渲染贴近真卡的微光骨架（不再整页空白·感知等待远长于实际）；
//   ② 列表增量 setData：onReachBottom 翻页只以路径键 shown[N]/list[N] 追加新行，不整表重发已渲染卡
//      （整表重发传输 O(n²)·根因#7）。reload/switchTab 全量替换本该全发·不在此约束内。
// Page 桩挂载范式同 me-cont-failed.test.ts（node 环境无小程序运行时·全局 Page 捕获 options）。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import orderWxml from '../pages/order-list/order-list.wxml?raw'
import orderWxss from '../pages/order-list/order-list.wxss?raw'
import reviewsWxml from '../pages/reviews/reviews.wxml?raw'
import reviewsWxss from '../pages/reviews/reviews.wxss?raw'

const { getMyOrdersMock, getReviewsMock } = vi.hoisted(() => ({
  getMyOrdersMock: vi.fn(),
  getReviewsMock: vi.fn(),
}))
// order-list 依赖：只钉 setData 形状，mapOrders 走轻量桩（非映射测试·映射由 orders-map golden 守）
vi.mock('../api/orders', () => ({
  getMyOrders: getMyOrdersMock,
  pay: vi.fn(),
  confirmReceive: vi.fn(),
  cancelOrder: vi.fn(),
}))
vi.mock('../lib/payFlow', () => ({ mapPayResult: vi.fn() }))
vi.mock('../lib/mapOrders', () => ({
  mapOrders: (list: Array<{ id: string }>) =>
    list.map((o) => ({ id: o.id, status: 'pending', amountLabel: '¥1', items: [], createdAtLabel: '', statusLabel: '', count: 1 })),
}))
vi.mock('../lib/orderSwipe', () => ({ swipeDir: vi.fn(), nextTabKey: vi.fn() }))
// reviews 依赖
vi.mock('../api/reviews', () => ({ getReviews: getReviewsMock }))
vi.mock('../lib/mapReviews', () => ({
  mapReviews: (list: Array<Record<string, unknown>>) => list.map((r) => ({ ...r })),
  mapSummary: () => null,
}))
// 两页共用：haptics
vi.mock('../lib/haptics', () => ({ tapHaptic: vi.fn() }))

let pageOpts: Record<string, any> = {}
;(globalThis as any).Page = (o: unknown) => {
  pageOpts = o as Record<string, any>
}
;(globalThis as any).wx = { showToast: vi.fn(), navigateTo: vi.fn(), showModal: vi.fn(), requestPayment: vi.fn(), previewImage: vi.fn() }

// setData 桩：既写普通键，也解析路径键 arr[N]（增量追加须真落进 this.data 数组·下次 length 才对）。
function makePage(): Record<string, any> {
  const page = Object.create(pageOpts) as Record<string, any>
  page.data = { ...pageOpts.data }
  page.setData = function (patch: Record<string, unknown>) {
    for (const [k, v] of Object.entries(patch)) {
      const m = k.match(/^(\w+)\[(\d+)\]$/)
      if (m) {
        if (!Array.isArray((this.data as any)[m[1]])) (this.data as any)[m[1]] = []
        ;(this.data as any)[m[1]][Number(m[2])] = v
      } else {
        ;(this.data as any)[k] = v
      }
    }
  }
  return page
}
async function mountOrderList(): Promise<Record<string, any>> {
  vi.resetModules()
  await import('../pages/order-list/order-list')
  return makePage()
}
async function mountReviews(): Promise<Record<string, any>> {
  vi.resetModules()
  await import('../pages/reviews/reviews')
  return makePage()
}

// 捕获 setData 调用序列（拿到「翻页那次」的 patch 断言键形状）
function spySetData(page: Record<string, any>): Array<Record<string, unknown>> {
  const calls: Array<Record<string, unknown>> = []
  const orig = page.setData.bind(page)
  page.setData = (patch: Record<string, unknown>) => {
    calls.push(patch)
    orig(patch)
  }
  return calls
}

beforeEach(() => {
  getMyOrdersMock.mockReset()
  getReviewsMock.mockReset()
})

describe('列表翻页增量 setData（根因#7·翻页只追加新行·不整表重发已渲染卡）', () => {
  it('大白话：order-list 触底翻页的 setData 含路径键 shown[N]、不含整表键 shown/all；新行接在已有条数之后', async () => {
    getMyOrdersMock.mockResolvedValueOnce({ ok: true, list: [{ id: 'o1' }, { id: 'o2' }], nextCursor: 'c1', hasMore: true })
    const page = await mountOrderList()
    await page.reload()
    expect(page.data.shown.length).toBe(2)

    getMyOrdersMock.mockResolvedValueOnce({ ok: true, list: [{ id: 'o3' }, { id: 'o4' }], nextCursor: null, hasMore: false })
    const calls = spySetData(page)
    await page.onReachBottom()
    const patch = calls[calls.length - 1]
    const keys = Object.keys(patch)
    expect(keys.some((k) => /^shown\[\d+\]$/.test(k))).toBe(true) // 路径键追加
    expect(keys).not.toContain('shown') // 不整表重发
    expect(keys).not.toContain('all') // all 已迁实例字段·不再进 setData
    expect(patch['shown[2]']).toBeTruthy() // 接在原 2 条之后
    expect(patch['shown[3]']).toBeTruthy()
    expect(page.data.shown.length).toBe(4)
  })

  it('大白话：reviews 触底翻页的 setData 含路径键 list[N]、不含整表键 list；新行接在已有条数之后', async () => {
    getReviewsMock.mockResolvedValueOnce({ ok: true, list: [{ id: 'r1' }, { id: 'r2' }], summary: null, nextCursor: 'c1', hasMore: true })
    const page = await mountReviews()
    await page.reload()
    expect(page.data.list.length).toBe(2)

    getReviewsMock.mockResolvedValueOnce({ ok: true, list: [{ id: 'r3' }], summary: null, nextCursor: null, hasMore: false })
    const calls = spySetData(page)
    await page.onReachBottom()
    const patch = calls[calls.length - 1]
    const keys = Object.keys(patch)
    expect(keys.some((k) => /^list\[\d+\]$/.test(k))).toBe(true)
    expect(keys).not.toContain('list')
    expect(patch['list[2]']).toBeTruthy()
    expect(page.data.list.length).toBe(3)
  })
})

describe('钱链后高频页骨架屏（根因#8·加载中不再整页空白）', () => {
  it('大白话：order-list.wxml 有「加载中且列表空」骨架块（coolist-skel·条件 loading && !shown.length）', () => {
    expect(orderWxml).toMatch(/wx:if="\{\{loading && !shown\.length\}\}"/)
    expect(orderWxml).toContain('coolist-skel')
  })
  it('大白话：order-list.wxss 骨架类引全局微光动画 ld-shimmer', () => {
    expect(orderWxss).toMatch(/coolist-skel/)
    expect(orderWxss).toMatch(/ld-shimmer/)
  })
  it('大白话：order-list.wxml 保留 coolist-body {{anim}} 字面（防手势/动画守卫连带回归·order-swipe.test.ts:91）', () => {
    expect(orderWxml).toMatch(/class="coolist-body \{\{anim\}\}"/)
  })
  it('大白话：reviews.wxml 有「加载中且列表空」骨架块（ld-rv-skel·条件 loading && !list.length）', () => {
    expect(reviewsWxml).toMatch(/wx:if="\{\{loading && !list\.length\}\}"/)
    expect(reviewsWxml).toContain('ld-rv-skel')
  })
  it('大白话：reviews.wxss 骨架类引全局微光动画 ld-shimmer', () => {
    expect(reviewsWxss).toMatch(/ld-rv-skel/)
    expect(reviewsWxss).toMatch(/ld-shimmer/)
  })
})

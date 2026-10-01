// 订单列表切页签减负（Issue #442·2026-10-02 开发者工具实测：切一次 3 次 setData、每次重带同一份售后、整表 22KB）：
//   ① 切页签只 2 次 setData（清空+加载中 → 填数据），不再在 reload 里重复置 loading；
//   ② 售后在新鲜期内不重带（withAfterSales 只在首次 / 写操作标脏 / 过 30s 后带），切页签复用已有叠加；
//   ③ 列表行只放模板用得到的字段——收件人地址、物流单号、商品明细等不显示的不发渲染层（传输小、也不该把收件人送过去）。
// 只桩云调用（callApp），页面 / api / utils 用真的。Page 桩同 list-fresh-onshow.test.ts。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { callAppMock } = vi.hoisted(() => ({ callAppMock: vi.fn() }))
vi.mock('../utils/cloud', () => ({ callApp: callAppMock }))
vi.mock('../lib/haptics', () => ({ tapHaptic: vi.fn() }))

let pageOpts: Record<string, any> = {}
;(globalThis as any).Page = (o: unknown) => {
  pageOpts = o as Record<string, any>
}

let sets: Record<string, unknown>[] = []
async function mount(): Promise<Record<string, any>> {
  vi.resetModules()
  await import('../pages/order-list/order-list')
  const page = Object.create(pageOpts) as Record<string, any>
  page.data = { ...pageOpts.data, shown: [] }
  page._all = []
  page.setData = function (patch: Record<string, unknown>) {
    sets.push(patch)
    for (const [k, v] of Object.entries(patch)) {
      const m = k.match(/^(\w+)\[(\d+)\](?:\.(\w+))?$/)
      if (m && m[3]) (this.data as any)[m[1]][Number(m[2])][m[3]] = v
      else if (m) (this.data as any)[m[1]][Number(m[2])] = v
      else (this.data as any)[k] = v
    }
  }
  page.onLoad({})
  return page
}
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}
const ORDER = (id: string, status = 'paid') => ({
  _id: id,
  status,
  amount: 128,
  createdAt: Date.now(),
  address: { name: '张三', phone: '13800000000', region: '浙江·杭州', detail: 'xx 路 1 号' },
  trackingNo: 'SF123',
  items: [
    { lineId: 'L1', name: '小鸭', price: 64, qty: 1, cover: 'https://x/c1.jpg' },
    { lineId: 'L2', name: '云朵鸭', price: 64, qty: 1, cover: 'https://x/c2.jpg' },
  ],
})
const orderCalls = () => callAppMock.mock.calls.filter((c) => c[0] === 'getMyOrders').map((c) => c[1])

beforeEach(() => {
  sets = []
  callAppMock.mockReset().mockImplementation(async (action: string) =>
    action === 'getMyOrders' ? { ok: true, list: [ORDER('o1'), ORDER('o2', 'pending')], nextCursor: null, hasMore: false, afterSales: [] } : { ok: false, error: 'UNEXPECTED' }
  )
  ;(globalThis as any).wx = { showToast: vi.fn(), navigateTo: vi.fn() }
})

describe('订单列表切页签减负（#442）', () => {
  it('大白话：切一次页签只更新 2 次（清空 + 加载中一次、填数据一次），不再多一次单独的「加载中」', async () => {
    const page = await mount()
    await page.reload()
    sets = []
    page.switchTab('pending')
    await flush()
    expect(sets).toHaveLength(2)
    expect(sets[0]).toMatchObject({ tabKey: 'pending', shown: [], loading: true })
    expect(sets[1]).toMatchObject({ loading: false })
  })

  it('大白话：首次进页带回售后；30 秒内切页签不再重带；做过订单写操作（标脏）后再切就重新带', async () => {
    const page = await mount()
    await page.reload()
    page.switchTab('pending')
    await flush()
    const { markStale } = await import('../utils/fresh') // resetModules 之后动态取，与页面拿到的是同一份
    markStale('orders')
    page.switchTab('paid')
    await flush()
    expect(orderCalls().map((d) => !!d.withAfterSales)).toEqual([true, false, true])
  })

  it('大白话：列表行只放模板用得到的字段——不带收件人地址、物流单号、商品明细', async () => {
    const page = await mount()
    await page.reload()
    const row = page.data.shown[0]
    expect(Object.keys(row).sort()).toEqual(['amountNum', 'amountTitle', 'cd', 'count', 'expired', 'id', 'label', 'labelColor', 'led', 'reviewedAll', 'right', 'status', 'thumbs', 'truck'])
    expect(row.thumbs).toEqual([{ lineId: 'L1', cover: 'https://x/c1.jpg' }, { lineId: 'L2', cover: 'https://x/c2.jpg' }])
    expect(JSON.stringify(page.data.shown)).not.toMatch(/张三|13800000000|SF123|云朵鸭/)
  })

  it('大白话：瘦身后倒计时照常——待支付单每秒刷新剩余时间（从完整数据取下单时间）', async () => {
    const page = await mount()
    await page.reload()
    const before = page.data.shown[1].cd
    expect(before).toMatch(/\d/)
    const spy = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 61_000)
    page.tick()
    spy.mockRestore()
    expect(page.data.shown[1].cd).not.toBe(before)
  })
})

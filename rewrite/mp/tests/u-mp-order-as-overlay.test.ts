// 订单详情/列表叠加售后显示（老板真机反馈「退款申请后还显示正在发货」）：云端退款不改订单状态，
// 页面另拉本人售后按单叠加「售后中 / 已退款」与行标；拉失败静默不叠加。只桩云调用（callApp），其余用真的。
// Page 桩同 p-mp-order-page / p-mp-order-list-page。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { callAppMock } = vi.hoisted(() => ({ callAppMock: vi.fn() }))
vi.mock('../utils/cloud', () => ({ callApp: callAppMock }))
vi.mock('../lib/haptics', () => ({ tapHaptic: vi.fn() }))
vi.mock('../utils/customerService', () => ({ openCustomerService: vi.fn() }))

let pageOpts: Record<string, any> = {}
;(globalThis as any).Page = (o: unknown) => {
  pageOpts = o as Record<string, any>
}

async function mount(path: string, query: Record<string, string> = {}): Promise<Record<string, any>> {
  vi.resetModules()
  await import(path)
  const page = Object.create(pageOpts) as Record<string, any>
  page.data = { ...pageOpts.data, shown: [] }
  page._all = []
  page.setData = function (patch: Record<string, unknown>) {
    for (const [k, v] of Object.entries(patch)) {
      const m = k.match(/^(\w+)\[(\d+)\]$/)
      if (m) (this.data as any)[m[1]][Number(m[2])] = v
      else (this.data as any)[k] = v
    }
  }
  page.onLoad(query)
  return page
}

const ORDER = (id: string, status: string) => ({
  _id: id,
  status,
  amount: 128,
  items: [
    { lineId: 'L1', name: '小鸭', price: 64, qty: 1 },
    { lineId: 'L2', name: '云朵鸭', price: 64, qty: 1 },
  ],
})
const AS = (orderId: string, lineId: string, status: string) => ({ _id: orderId + '__' + lineId, orderId, lineId, status, appliedAt: 1 })

let handlers: Record<string, (data: Record<string, any>) => unknown>
let wxMock: Record<string, any>
const asCalls = () => callAppMock.mock.calls.filter((c: unknown[]) => c[0] === 'getMyAfterSales')
// 列表（性能批 #3）：售后随 getMyOrders(withAfterSales) 一次带回，数「带 flag 的那次」
const listAsCalls = () => callAppMock.mock.calls.filter((c: any[]) => c[0] === 'getMyOrders' && c[1] && c[1].withAfterSales === true)

beforeEach(() => {
  handlers = { getOrderById: () => ({ ok: true, order: ORDER('o1', 'paid') }) }
  callAppMock.mockReset().mockImplementation(async (action: string, data: Record<string, any>) =>
    handlers[action] ? handlers[action](data) : { ok: false, error: 'UNEXPECTED' }
  )
  wxMock = { showToast: vi.fn(), showModal: vi.fn(), showLoading: vi.fn(), hideLoading: vi.fn(), navigateTo: vi.fn(), redirectTo: vi.fn(), requestPayment: vi.fn() }
  ;(globalThis as any).wx = wxMock
  ;(globalThis as any).getCurrentPages = () => [{}]
})

describe('订单详情叠加售后', () => {
  const detail = () => mount('../pages/order/order', { id: 'o1' })

  it('大白话：申请退款后回到详情——状态卡「售后中」墨点 + 「退款申请已提交，审核后原路退回」，那件标「退款中」，出「查看售后进度」入口', async () => {
    handlers.getMyAfterSales = () => ({ ok: true, list: [AS('o1', 'L1', 'applied'), AS('o9', 'L1', 'refunded')] })
    const page = await detail()
    await page.reload()
    expect(callAppMock).toHaveBeenCalledWith('getMyAfterSales', { cursor: undefined, limit: 100, orderId: 'o1' }) // 只拉本单售后（#443）
    expect(page.data).toMatchObject({ head: '售后中', sub: { text: '退款申请已提交，审核后原路退回', tone: '' }, asLed: { tone: 'var(--v5-ink)', halo: '' }, asHas: true, lineTags: { L1: '退款中' } })
    expect(page.data.vm.status).toBe('paid') // 订单状态本身不动

    handlers.getMyAfterSales = () => ({ ok: true, list: [AS('o1', 'L1', 'approved')] })
    await page.reload()
    expect(page.data.sub.text).toBe('退款处理中，完成后原路退回')

    page.onGoAfterSales()
    expect(wxMock.navigateTo.mock.calls[0][0].url).toBe('/pages/aftersales/aftersales')
  })

  it('大白话：全部商品都退完——「已退款」灰圈墨字；只退了一件——状态照旧，只那件标「已退款」', async () => {
    handlers.getMyAfterSales = () => ({ ok: true, list: [AS('o1', 'L1', 'refunded'), AS('o1', 'L2', 'refunded')] })
    const page = await detail()
    await page.reload()
    expect(page.data).toMatchObject({ head: '已退款', asLed: { tone: 'rgba(17,17,17,.28)', halo: 'none' }, headColor: '' })

    handlers.getMyAfterSales = () => ({ ok: true, list: [AS('o1', 'L1', 'refunded')] })
    await page.reload()
    expect(page.data).toMatchObject({ head: '待发货', asLed: { tone: 'var(--v5-ink)', halo: '' }, headColor: '', asHas: true, lineTags: { L1: '已退款' } })
    expect(page.data.sub.text).toBe('商家会在 48 小时内发货')
  })

  it('大白话：售后拉取失败——订单照原样显示、不报错、不出「查看售后进度」；被拒的售后不影响状态', async () => {
    handlers.getMyAfterSales = () => ({ ok: false, error: 'CALL_TIMEOUT' })
    const page = await detail()
    await page.reload()
    expect(page.data).toMatchObject({ loading: false, loadFailed: false, head: '待发货', asLed: { tone: 'var(--v5-ink)', halo: '' }, asHas: false, lineTags: {} })
    expect(wxMock.showToast).not.toHaveBeenCalled()

    handlers.getMyAfterSales = () => ({ ok: true, list: [AS('o1', 'L1', 'rejected')] })
    await page.reload()
    expect(page.data).toMatchObject({ head: '待发货', asLed: { tone: 'var(--v5-ink)', halo: '' }, asHas: true, lineTags: {} })
  })

  it('大白话：详情里申请退款成功→跳售后页→返回详情（onShow）显示「售后中 · 退款申请中」；返回时售后刷新没拉到也照样显示', async () => {
    let asList: unknown[] = []
    handlers.getMyAfterSales = () => ({ ok: true, list: asList })
    handlers.applyRefund = (d) => {
      const rec = AS('o1', d.lineId, 'applied')
      asList = [rec]
      return { ok: true, afterSale: rec }
    }
    const page = await detail()
    await page.reload()
    expect(page.data.head).toBe('待发货')
    await page.onAfterSale()
    await page.onAsSubmit()
    expect(wxMock.navigateTo.mock.calls[0][0].url).toBe('/pages/aftersales/aftersales')

    page.onShow() // 从售后页返回
    await new Promise((r) => setTimeout(r, 0))
    page.onHide()
    expect(page.data).toMatchObject({ head: '售后中', sub: { text: '退款申请已提交，审核后原路退回', tone: '' }, asHas: true, lineTags: { L1: '退款中' } })
  })

  it('大白话：申请成功后返回详情时售后刷新没拉到——用刚提交的那张售后单照样显示「售后中」，不退回「正在发货」', async () => {
    handlers.getMyAfterSales = () => ({ ok: true, list: [] })
    handlers.applyRefund = (d) => ({ ok: true, afterSale: AS('o1', d.lineId, 'applied') })
    const page = await detail()
    await page.reload()
    await page.onAfterSale()
    await page.onAsSubmit()
    handlers.getMyAfterSales = () => ({ ok: false, error: 'CALL_TIMEOUT' })
    await page.reload()
    expect(page.data).toMatchObject({ head: '售后中', lineTags: { L1: '退款中' } })
  })

  it('大白话：已拉到售后记录时点「申请售后」——复用这份记录，不再重复拉', async () => {
    handlers.getOrderById = () => ({ ok: true, order: ORDER('o1', 'done') })
    handlers.getMyAfterSales = () => ({ ok: true, list: [AS('o1', 'L1', 'applied')] })
    const page = await detail()
    await page.reload()
    await page.onAfterSale()
    expect(asCalls()).toHaveLength(1)
    expect(page.data.asOpen).toBe(true)
    expect(page.data.asLines.map((l: { lineId: string }) => l.lineId)).toEqual(['L2']) // 已申请的 L1 排除
  })
})

describe('订单列表叠加售后', () => {
  const list = () => mount('../pages/order-list/order-list')

  it('大白话：卡片按售后叠加（售后随订单一次带回·性能批 #3）——售后中墨点 + 右侧「退款申请中」（不再显示小货车）、全退完「已退款」、没售后的照旧；翻页不重复带售后', async () => {
    const afterSales = [AS('o1', 'L1', 'applied'), AS('o2', 'L1', 'refunded'), AS('o2', 'L2', 'refunded'), AS('o4', 'L1', 'approved')]
    handlers.getMyOrders = () => ({ ok: true, list: [ORDER('o1', 'shipped'), ORDER('o2', 'done'), ORDER('o3', 'paid')], nextCursor: 'c1', hasMore: true, afterSales })
    const page = await list()
    await page.reload()
    expect(listAsCalls()).toHaveLength(1)
    expect(asCalls()).toHaveLength(0) // 列表不再另拉 getMyAfterSales
    const [o1, o2, o3] = page.data.shown
    expect(o1).toMatchObject({ label: '售后中', led: { tone: 'var(--v5-ink)', halo: '' }, right: '退款申请中', truck: false, labelColor: '' })
    expect(o2).toMatchObject({ label: '已退款', led: { tone: 'rgba(17,17,17,.28)', halo: 'none' }, right: '已原路退回', labelColor: '' })
    expect(o3).toMatchObject({ label: '待发货', right: '48 小时内发货' })

    handlers.getMyOrders = () => ({ ok: true, list: [ORDER('o4', 'shipped')], nextCursor: null, hasMore: false }) // 翻页回包不带售后
    await page.onReachBottom()
    expect(listAsCalls()).toHaveLength(1)
    expect(page.data.shown[3]).toMatchObject({ label: '售后中', right: '退款处理中' }) // 复用首载带回的售后
  })

  it('大白话：云端售后读失败（回包不带 afterSales 键）——卡片照原样、不弹提示', async () => {
    handlers.getMyOrders = () => ({ ok: true, list: [ORDER('o1', 'shipped')], nextCursor: null, hasMore: false })
    const page = await list()
    await page.reload()
    expect(page.data.shown[0]).toMatchObject({ label: '待收货', truck: true, labelColor: '' })
    expect(wxMock.showToast).not.toHaveBeenCalled()
  })
})

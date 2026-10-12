// 我的售后页主路径行为：进页加载、失败≠空态（一无所有亮重试、已有列表只轻提示）、过期回包丢弃、
// 查看订单/联系客服入口、翻页（追加去重、失败提示不清空、被刷新作废、在途不重发）。
// 只桩云调用（callApp），api/映射/导航都用真的。Page 桩同 p-mp-order-list-page.test.ts。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { callAppMock } = vi.hoisted(() => ({ callAppMock: vi.fn() }))
vi.mock('../utils/cloud', () => ({ callApp: callAppMock }))

let pageOpts: Record<string, any> = {}
;(globalThis as any).Page = (o: unknown) => {
  pageOpts = o as Record<string, any>
}

async function mount(): Promise<Record<string, any>> {
  vi.resetModules()
  await import('../pages/aftersales/aftersales')
  const page = Object.create(pageOpts) as Record<string, any>
  page.data = { ...pageOpts.data, list: [] }
  page.setData = function (patch: Record<string, unknown>) {
    Object.assign(this.data as Record<string, unknown>, patch)
  }
  return page
}

const as = (id: string, status = 'applied') => ({ _id: id, orderId: 'o-' + id, lineId: 'L1', name: '小鸭', spec: '红', qty: 1, refundAmount: 64, status, appliedAt: 1 })
const ids = (page: Record<string, any>) => page.data.list.map((a: { id: string }) => a.id)
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}

let handlers: Record<string, (data: Record<string, any>) => unknown>
let wxMock: Record<string, any>
let stackDepth = 1

beforeEach(() => {
  handlers = { getMyAfterSales: () => ({ ok: true, list: [as('a1'), as('a2', 'refunded')], nextCursor: 'c1', hasMore: true }) }
  callAppMock.mockReset().mockImplementation(async (action: string, data: Record<string, any>) =>
    handlers[action] ? handlers[action](data) : { ok: false, error: 'UNEXPECTED' }
  )
  wxMock = { showToast: vi.fn(), navigateTo: vi.fn(), redirectTo: vi.fn(), openCustomerServiceChat: vi.fn() }
  ;(globalThis as any).wx = wxMock
  stackDepth = 1
  ;(globalThis as any).getCurrentPages = () => Array.from({ length: stackDepth })
})

describe('我的售后：加载', () => {
  it('大白话：进页拉第一页——状态说人话、退款金额两位小数、记下游标', async () => {
    const page = await mount()
    expect(page.data.loading).toBe(true)
    page.onShow()
    await flush()
    expect(callAppMock).toHaveBeenCalledWith('getMyAfterSales', { cursor: undefined, limit: 20 })
    expect(page.data).toMatchObject({ loading: false, loadFailed: false, cursor: 'c1', hasMore: true })
    expect(page.data.list[0]).toMatchObject({ id: 'a1', orderId: 'o-a1', statusLabel: '申请中', refundAmountLabel: '¥64.00' })
    expect(page.data.list[1].statusLabel).toBe('已退款')
  })

  it('大白话：一条都没有时网络失败——亮重试态、不说「还没有售后记录」、不弹提示；点重试重新拉', async () => {
    handlers.getMyAfterSales = () => ({ ok: false, error: 'CALL_TIMEOUT' })
    const page = await mount()
    await page.reload()
    expect(page.data).toMatchObject({ loading: false, loadFailed: true, list: [] })
    expect(wxMock.showToast).not.toHaveBeenCalled()

    handlers.getMyAfterSales = () => ({ ok: true, list: [], nextCursor: null, hasMore: false })
    page.onRetryLoad()
    expect(page.data).toMatchObject({ loading: true, loadFailed: false })
    await flush()
    expect(page.data).toMatchObject({ loading: false, loadFailed: false, list: [], hasMore: false }) // 真没有才是空态
  })

  it('大白话：已有记录时刷新失败——列表不清空，只轻提示', async () => {
    const page = await mount()
    await page.reload()
    handlers.getMyAfterSales = () => ({ ok: false, error: 'CALL_FAIL' })
    await page.reload()
    expect(ids(page)).toEqual(['a1', 'a2'])
    expect(page.data.loadFailed).toBe(false)
    expect(wxMock.showToast).toHaveBeenCalledWith({ title: '刷新失败，请稍后重试', icon: 'none' })
  })

  it('大白话：两次刷新并发、先发的后回——旧回包丢掉，不覆盖新列表', async () => {
    let releaseOld!: (v: unknown) => void
    handlers.getMyAfterSales = () => new Promise((r) => (releaseOld = r))
    const page = await mount()
    const old = page.reload()
    handlers.getMyAfterSales = () => ({ ok: true, list: [as('new')], nextCursor: null, hasMore: false })
    await page.reload()
    releaseOld({ ok: true, list: [as('stale')], nextCursor: 'x', hasMore: true })
    await old
    expect(ids(page)).toEqual(['new'])
    expect(page.data.hasMore).toBe(false)
  })
})

describe('我的售后：入口', () => {
  it('大白话：点一条售后——去它的订单详情（从那里申请/看进度）；页面栈快满了改成替换本页', async () => {
    const page = await mount()
    page.onTapOrder({ currentTarget: { dataset: { id: 'o-a1' } } })
    expect(wxMock.navigateTo).toHaveBeenCalledWith(expect.objectContaining({ url: '/pages/order/order?id=o-a1' }))
    stackDepth = 8
    page.onTapOrder({ currentTarget: { dataset: { id: 'o-a2' } } })
    expect(wxMock.redirectTo).toHaveBeenCalledWith({ url: '/pages/order/order?id=o-a2' })
  })

  it('大白话：点「联系客服」——拉起微信客服；拉不起来提示，不静默', async () => {
    const page = await mount()
    page.onKefu()
    expect(wxMock.openCustomerServiceChat).toHaveBeenCalledTimes(1)
    wxMock.openCustomerServiceChat.mock.calls[0][0].fail()
    expect(wxMock.showToast).toHaveBeenCalledWith({ title: '客服暂时打不开，请稍后再试', icon: 'none' })
  })
})

describe('我的售后：翻页', () => {
  it('大白话：触底带游标拉下一页，重复的不再追加，新记录接在后面', async () => {
    const page = await mount()
    await page.reload()
    handlers.getMyAfterSales = (d) => (d.cursor === 'c1' ? { ok: true, list: [as('a2'), as('a3')], nextCursor: null, hasMore: false } : { ok: false })
    await page.onReachBottom()
    expect(ids(page)).toEqual(['a1', 'a2', 'a3'])
    expect(page.data).toMatchObject({ cursor: null, hasMore: false })
  })

  it('大白话：没有下一页时触底不发请求', async () => {
    handlers.getMyAfterSales = () => ({ ok: true, list: [as('a1')], nextCursor: null, hasMore: false })
    const page = await mount()
    await page.reload()
    callAppMock.mockClear()
    await page.onReachBottom()
    expect(callAppMock).not.toHaveBeenCalled()
  })

  it('大白话：翻页失败——提示上拉重试，已有列表不动', async () => {
    const page = await mount()
    await page.reload()
    handlers.getMyAfterSales = () => ({ ok: false, error: 'CALL_FAIL' })
    await page.onReachBottom()
    expect(ids(page)).toEqual(['a1', 'a2'])
    expect(page.data.cursor).toBe('c1')
    expect(wxMock.showToast).toHaveBeenCalledWith({ title: '加载失败，上拉重试', icon: 'none' })
  })

  it('大白话：翻页在途时列表被刷新——晚到的那页丢掉，不接到新列表后面', async () => {
    const page = await mount()
    await page.reload()
    let release!: (v: unknown) => void
    handlers.getMyAfterSales = (d) => (d.cursor === 'c1' ? new Promise((r) => (release = r)) : { ok: true, list: [as('fresh')], nextCursor: 'c9', hasMore: true })
    const paging = page.onReachBottom()
    await page.reload()
    release({ ok: true, list: [as('late')], nextCursor: null, hasMore: false })
    await paging
    expect(ids(page)).toEqual(['fresh'])
    expect(page.data.cursor).toBe('c9')
  })

  it('大白话：上一页还没回来又触底——不重复请求；这页失败后解锁，再触底能重拉', async () => {
    const page = await mount()
    await page.reload()
    const releases: Array<(v: unknown) => void> = []
    handlers.getMyAfterSales = () => new Promise((r) => releases.push(r))
    callAppMock.mockClear()
    const pending = [page.onReachBottom(), page.onReachBottom()]
    await flush()
    expect(callAppMock).toHaveBeenCalledTimes(1)
    releases.forEach((r) => r({ ok: false, error: 'CALL_FAIL' }))
    await Promise.all(pending)
    callAppMock.mockClear()
    handlers.getMyAfterSales = () => ({ ok: true, list: [as('a3')], nextCursor: null, hasMore: false })
    await page.onReachBottom()
    expect(callAppMock).toHaveBeenCalledTimes(1)
    expect(ids(page)).toEqual(['a1', 'a2', 'a3'])
  })
})

// 我的订单列表主路径行为：按 tab 拉取、失败/空态分治、过期回包、翻页（失败提示/去重/被刷新作废）、切 tab 与手势、
// 继续支付、确认收货、取消订单。只桩云调用（callApp），api/映射/支付结果判定/手势判定都用真的。Page 桩同 me-cont-failed.test.ts。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { callAppMock } = vi.hoisted(() => ({ callAppMock: vi.fn() }))
vi.mock('../utils/cloud', () => ({ callApp: callAppMock }))
vi.mock('../lib/haptics', () => ({ tapHaptic: vi.fn() }))

let pageOpts: Record<string, any> = {}
;(globalThis as any).Page = (o: unknown) => {
  pageOpts = o as Record<string, any>
}

// setData 桩解析路径键 shown[N]（翻页按路径键增量追加）
async function mount(query: Record<string, string> = {}): Promise<Record<string, any>> {
  vi.resetModules()
  await import('../pages/order-list/order-list')
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

const order = (id: string, status = 'pending') => ({ _id: id, status, amount: 128, items: [{ lineId: 'L1', name: '小鸭', price: 64, qty: 2 }] })
const PAYMENT = { timeStamp: '1', nonceStr: 'n', package: 'prepay_id=x', signType: 'RSA', paySign: 's' }
const tap = (id: string) => ({ currentTarget: { dataset: { id } } })

let handlers: Record<string, (data: Record<string, any>) => unknown>
let wxMock: Record<string, any>
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}
const ids = (page: Record<string, any>) => page.data.shown.map((o: { id: string }) => o.id)
const modal = (n = 0) => wxMock.showModal.mock.calls[n][0]

beforeEach(() => {
  handlers = { getMyOrders: () => ({ ok: true, list: [order('o1'), order('o2', 'done')], nextCursor: 'c1', hasMore: true }) }
  callAppMock.mockReset().mockImplementation(async (action: string, data: Record<string, any>) =>
    handlers[action] ? handlers[action](data) : { ok: false, error: 'UNEXPECTED' }
  )
  wxMock = { showToast: vi.fn(), showModal: vi.fn(), showLoading: vi.fn(), hideLoading: vi.fn(), navigateTo: vi.fn(), requestPayment: vi.fn() }
  ;(globalThis as any).wx = wxMock
})

describe('订单列表：加载', () => {
  it('大白话：进页按 query 里的 tab 拉该状态的第一页；卡片带状态染色、金额和单价拆掉 ¥ 符号', async () => {
    const page = await mount({ tab: 'pending' })
    page.onShow()
    await flush()
    expect(callAppMock).toHaveBeenCalledWith('getMyOrders', { cursor: undefined, limit: 20, status: 'pending' })
    expect(page.data).toMatchObject({ loading: false, loadFailed: false, cursor: 'c1', hasMore: true, anim: '' })
    expect(page.data.shown[0]).toMatchObject({ id: 'o1', tint: 'purple', amountNum: '128.00' })
    expect(page.data.shown[0].items[0].priceNum).toBe('64.00')
    expect(page.data.shown[1].tint).toBe('sage')
  })

  it('大白话：query 里的 tab 不认识就停在「全部」', async () => {
    const page = await mount({ tab: 'bogus' })
    expect(page.data.tabKey).toBe('')
  })

  it('大白话：一单都没有时网络失败——亮重试态、不弹提示；点重试重新拉取', async () => {
    handlers.getMyOrders = () => ({ ok: false, error: 'CALL_TIMEOUT' })
    const page = await mount()
    await page.reload()
    expect(page.data).toMatchObject({ loading: false, loadFailed: true })
    expect(wxMock.showToast).not.toHaveBeenCalled()

    handlers.getMyOrders = () => ({ ok: true, list: [], nextCursor: null, hasMore: false })
    page.onRetryLoad()
    await flush()
    expect(page.data).toMatchObject({ loading: false, loadFailed: false, shown: [], hasMore: false })
  })

  it('大白话：已有订单时刷新失败——列表不清空，只轻提示', async () => {
    const page = await mount()
    await page.reload()
    handlers.getMyOrders = () => ({ ok: false, error: 'CALL_FAIL' })
    await page.reload()
    expect(ids(page)).toEqual(['o1', 'o2'])
    expect(page.data.loadFailed).toBe(false)
    expect(wxMock.showToast).toHaveBeenCalledWith({ title: '刷新失败，请稍后重试', icon: 'none' })
  })

  it('大白话：同一 tab 两次刷新并发、先发的后回——旧回包丢掉，不覆盖新列表', async () => {
    let releaseOld!: (v: unknown) => void
    handlers.getMyOrders = () => new Promise((r) => (releaseOld = r))
    const page = await mount()
    const old = page.reload()
    handlers.getMyOrders = () => ({ ok: true, list: [order('new')], nextCursor: null, hasMore: false })
    await page.reload()
    releaseOld({ ok: true, list: [order('stale')], nextCursor: 'x', hasMore: true })
    await old
    expect(ids(page)).toEqual(['new'])
    expect(page.data.hasMore).toBe(false)
  })
})

describe('订单列表：翻页', () => {
  it('大白话：触底带游标拉下一页，重复的单不再追加，新单接在后面', async () => {
    const page = await mount()
    await page.reload()
    handlers.getMyOrders = (d) => (d.cursor === 'c1' ? { ok: true, list: [order('o2'), order('o3')], nextCursor: null, hasMore: false } : { ok: false })
    await page.onReachBottom()
    expect(ids(page)).toEqual(['o1', 'o2', 'o3'])
    expect(page.data).toMatchObject({ cursor: null, hasMore: false })
  })

  it('大白话：没有下一页或没有游标时触底不发请求', async () => {
    handlers.getMyOrders = () => ({ ok: true, list: [order('o1')], nextCursor: null, hasMore: true })
    const page = await mount()
    await page.reload()
    callAppMock.mockClear()
    await page.onReachBottom()
    page.data.hasMore = false
    page.data.cursor = 'c9'
    await page.onReachBottom()
    expect(callAppMock).not.toHaveBeenCalled()
  })

  it('大白话：翻页失败不静默——提示上拉重试，已有列表不动', async () => {
    const page = await mount()
    await page.reload()
    handlers.getMyOrders = () => ({ ok: false, error: 'CALL_FAIL' })
    await page.onReachBottom()
    expect(wxMock.showToast).toHaveBeenCalledWith({ title: '加载失败，上拉重试', icon: 'none' })
    expect(ids(page)).toEqual(['o1', 'o2'])
    expect(page.data.cursor).toBe('c1')
  })

  it('大白话：翻页在途时列表被刷新——翻页回包作废，失败也不对新列表弹提示', async () => {
    const page = await mount()
    await page.reload()
    let releasePage!: (v: unknown) => void
    handlers.getMyOrders = () => new Promise((r) => (releasePage = r))
    const more = page.onReachBottom()
    const firstRelease = releasePage
    handlers.getMyOrders = () => ({ ok: true, list: [order('fresh')], nextCursor: null, hasMore: false })
    await page.reload()
    firstRelease({ ok: false, error: 'CALL_FAIL' })
    await more
    expect(ids(page)).toEqual(['fresh'])
    expect(wxMock.showToast).not.toHaveBeenCalled()
  })
})

describe('订单列表：切 tab 与手势', () => {
  it('大白话：点 tab 清空并按新状态重拉，往右切带「自右滑入」动画；点当前 tab 不动', async () => {
    const page = await mount()
    await page.reload()
    callAppMock.mockClear()
    page.onTab({ currentTarget: { dataset: { key: '' } } })
    expect(callAppMock).not.toHaveBeenCalled()

    page.onTab({ currentTarget: { dataset: { key: 'shipped' } } })
    expect(page.data).toMatchObject({ tabKey: 'shipped', shown: [], cursor: null, hasMore: false, anim: '' })
    await flush()
    expect(callAppMock).toHaveBeenCalledWith('getMyOrders', { cursor: undefined, limit: 20, status: 'shipped' })
    expect(page.data.anim).toBe('anim-next')

    page.switchTab('pending')
    await flush()
    expect(page.data.anim).toBe('anim-prev')
    await page.reload() // 普通刷新不带动画
    expect(page.data.anim).toBe('')
  })

  it('大白话：切 tab 后旧 tab 的慢回包到了——丢掉，不串到新 tab', async () => {
    let releaseOld!: (v: unknown) => void
    handlers.getMyOrders = () => new Promise((r) => (releaseOld = r))
    const page = await mount()
    const old = page.reload()
    handlers.getMyOrders = () => ({ ok: true, list: [order('d1', 'done')], nextCursor: null, hasMore: false })
    page.switchTab('done')
    await flush()
    releaseOld({ ok: true, list: [order('all1')], nextCursor: null, hasMore: false })
    await old
    expect(ids(page)).toEqual(['d1'])
  })

  it('大白话：左滑切到下一个 tab；竖向滑或到头不切', async () => {
    const page = await mount()
    const swipe = (dx: number, dy: number) => {
      page.onSwipeStart({ touches: [{ clientX: 200, clientY: 300 }], timeStamp: 0 })
      page.onSwipeEnd({ changedTouches: [{ clientX: 200 + dx, clientY: 300 + dy }], timeStamp: 200 })
    }
    swipe(-120, 5)
    expect(page.data.tabKey).toBe('pending')
    swipe(5, 150)
    expect(page.data.tabKey).toBe('pending')
    page.data.tabKey = ''
    swipe(120, 0) // 「全部」左边没有 tab
    expect(page.data.tabKey).toBe('')
  })

  it('大白话：点订单卡进详情', async () => {
    const page = await mount()
    page.onTapOrder(tap('o7'))
    expect(wxMock.navigateTo).toHaveBeenCalledWith({ url: '/pages/order/order?id=o7' })
  })
})

describe('订单列表：继续支付', () => {
  it('大白话：云端说已付——提示「已支付」、解锁并刷新列表', async () => {
    handlers.pay = () => ({ ok: true, paid: true })
    const page = await mount()
    await page.onPay(tap('o1'))
    expect(callAppMock).toHaveBeenCalledWith('pay', { id: 'o1' })
    expect(wxMock.showToast).toHaveBeenCalledWith({ title: '已支付', icon: 'success' })
    expect(page.data.payingId).toBe('')
    expect(callAppMock).toHaveBeenCalledWith('getMyOrders', expect.anything())
  })

  it('大白话：收银台付成功提示「支付成功」；取消只解锁刷新不提示', async () => {
    handlers.pay = () => ({ ok: true, payment: PAYMENT })
    const page = await mount()
    await page.onPay(tap('o1'))
    expect(page.data.payingId).toBe('o1')
    wxMock.requestPayment.mock.calls[0][0].success()
    expect(wxMock.showToast).toHaveBeenCalledWith({ title: '支付成功', icon: 'success' })
    expect(page.data.payingId).toBe('')

    await page.onPay(tap('o2'))
    wxMock.requestPayment.mock.calls[1][0].fail({ errMsg: 'requestPayment:fail cancel' })
    expect(page.data.payingId).toBe('')
    expect(wxMock.showToast).toHaveBeenCalledTimes(1)
  })

  it('大白话：云端拒绝——如实提示原因并解锁', async () => {
    handlers.pay = () => ({ ok: false, error: 'PAY_NOT_ENABLED' })
    const page = await mount()
    await page.onPay(tap('o1'))
    expect(wxMock.showToast).toHaveBeenCalledWith({ title: '支付暂未开通', icon: 'none' })
    expect(page.data.payingId).toBe('')
  })

  it('大白话：发起支付在途时退出了列表页——不拉收银台，只提示去详情继续支付', async () => {
    let release!: (v: unknown) => void
    handlers.pay = () => new Promise((r) => (release = r))
    const page = await mount()
    const p = page.onPay(tap('o1'))
    page.onUnload()
    release({ ok: true, payment: PAYMENT })
    await p
    expect(wxMock.requestPayment).not.toHaveBeenCalled()
    expect(wxMock.showToast).toHaveBeenCalledWith({ title: '可到订单详情继续支付', icon: 'none' })
  })
})

describe('订单列表：确认收货与取消订单', () => {
  const cases = [
    { name: '确认收货', fn: 'onConfirm', action: 'confirmReceive', title: '确认收货', ok: '已确认收货', fail: '操作没成功，稍后再试' },
    { name: '取消订单', fn: 'onCancel', action: 'cancelOrder', title: '取消订单', ok: '订单已取消', fail: '取消没成功，稍后再试' },
  ]
  for (const c of cases) {
    it(`大白话：${c.name}——先确认；成功提示并刷新，失败提示稍后再试；不确认不发请求`, async () => {
      const page = await mount()
      handlers[c.action] = () => ({ ok: true })
      page[c.fn](tap('o1'))
      expect(modal().title).toBe(c.title)
      await modal().success({ confirm: false })
      expect(callAppMock).not.toHaveBeenCalledWith(c.action, expect.anything())

      await modal().success({ confirm: true })
      expect(callAppMock).toHaveBeenCalledWith(c.action, { id: 'o1' })
      expect(wxMock.showToast).toHaveBeenLastCalledWith({ title: c.ok, icon: 'success' })
      expect(callAppMock).toHaveBeenCalledWith('getMyOrders', expect.anything())

      handlers[c.action] = () => ({ ok: false, error: 'BAD_STATUS' })
      page[c.fn](tap('o1'))
      await modal(1).success({ confirm: true })
      expect(wxMock.showToast).toHaveBeenLastCalledWith({ title: c.fail, icon: 'none' })
    })

    it(`大白话：${c.name}请求在途时退出了列表页——回包后不再提示`, async () => {
      const page = await mount()
      handlers[c.action] = () => ({ ok: true })
      page[c.fn](tap('o1'))
      const done = modal().success({ confirm: true })
      page.onUnload()
      await done
      expect(wxMock.showToast).not.toHaveBeenCalled()
    })
  }
})

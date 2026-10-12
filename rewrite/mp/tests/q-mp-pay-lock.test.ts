// 继续支付（订单详情 / 订单列表）：发起支付在途时连点只发一次 pay、只拉一次收银台，并有加载反馈；
// 支付结束（成功/取消/失败/云端拒）都要解锁，否则用户再也点不动。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { payMock, cancelMock } = vi.hoisted(() => ({ payMock: vi.fn(), cancelMock: vi.fn() }))
vi.mock('../api/orders', () => ({
  pay: payMock,
  getOrderById: async () => ({ ok: false, error: 'NOT_FOUND' }),
  getMyOrders: async () => ({ ok: false, error: 'CALL_FAIL' }),
  confirmReceive: vi.fn(),
  cancelOrder: cancelMock,
  applyRefund: vi.fn(),
  getMyAfterSales: vi.fn(),
}))
vi.mock('../lib/haptics', () => ({ tapHaptic: vi.fn() }))

const PAYMENT = { timeStamp: '1', nonceStr: 'n', package: 'prepay_id=x', signType: 'RSA', paySign: 's' }
let wxMock: Record<string, any>
beforeEach(() => {
  payMock.mockReset()
  cancelMock.mockReset()
  wxMock = { showToast: vi.fn(), showLoading: vi.fn(), hideLoading: vi.fn(), requestPayment: vi.fn() }
  ;(globalThis as any).wx = wxMock
})

async function mount(path: string): Promise<Record<string, any>> {
  let opts: Record<string, any> = {}
  ;(globalThis as any).Page = (o: Record<string, any>) => (opts = o)
  vi.resetModules()
  await import(path)
  const page = Object.create(opts) as Record<string, any>
  page.data = { ...opts.data }
  page.setData = function (patch: Record<string, unknown>) {
    Object.assign(this.data as Record<string, unknown>, patch)
  }
  page.orderId = 'o1'
  return page
}

const deferred = () => {
  let resolve!: (v: unknown) => void
  const promise = new Promise((r) => (resolve = r))
  return { promise, resolve }
}

const PAGES = [
  { name: '订单详情', path: '../pages/order/order', ev: undefined },
  { name: '订单列表', path: '../pages/order-list/order-list', ev: { currentTarget: { dataset: { id: 'o1' } } } },
]

describe('继续支付时云端说微信那边已付、回调还没到（ORDER_ALREADY_PAID·#400）', () => {
  it('大白话：订单详情——状态卡改成「已付款，正在确认」、不出取消/去支付；按住取消也不会真去取消（取消会把已付的钱关进已关闭单）', async () => {
    const page = await mount('../pages/order/order')
    page.data.vm = { id: 'o1', status: 'pending', items: [] }
    payMock.mockResolvedValue({ ok: false, error: 'ORDER_ALREADY_PAID' })
    await page.onPay()
    expect(page.data.confirming).toBe(true)
    expect(page.data.head).toBe('已付款，正在确认')
    await page.cancelNow()
    expect(cancelMock).not.toHaveBeenCalled()
  })

  it('大白话：订单列表——那张卡记成「正在确认」、按住取消也不会真去取消', async () => {
    const page = await mount('../pages/order-list/order-list')
    payMock.mockResolvedValue({ ok: false, error: 'ORDER_ALREADY_PAID' })
    await page.onPay({ currentTarget: { dataset: { id: 'o1' } } })
    expect(page.data.confirmingId).toBe('o1')
    await page.cancelNow('o1')
    expect(cancelMock).not.toHaveBeenCalled()
  })
})

describe.each(PAGES)('$name 继续支付：在途锁 + 加载反馈', ({ path, ev }) => {
  it('大白话：发起支付还没回来时连点两次——只发一次 pay、只拉一次收银台，并显示加载', async () => {
    const page = await mount(path)
    const d = deferred()
    payMock.mockReturnValue(d.promise)
    const p1 = page.onPay(ev)
    const p2 = page.onPay(ev)
    expect(wxMock.showLoading).toHaveBeenCalledTimes(1)
    d.resolve({ ok: true, payment: PAYMENT })
    await Promise.all([p1, p2])
    expect(payMock).toHaveBeenCalledTimes(1)
    expect(wxMock.requestPayment).toHaveBeenCalledTimes(1)
    expect(wxMock.hideLoading).toHaveBeenCalled()
  })

  it('大白话：收银台开着时再点也不重发；取消支付后解锁，能再点一次', async () => {
    const page = await mount(path)
    payMock.mockResolvedValue({ ok: true, payment: PAYMENT })
    await page.onPay(ev)
    await page.onPay(ev)
    expect(payMock).toHaveBeenCalledTimes(1)
    wxMock.requestPayment.mock.calls[0][0].fail({ errMsg: 'requestPayment:fail cancel' })
    await page.onPay(ev)
    expect(payMock).toHaveBeenCalledTimes(2)
  })

  it('大白话：云端拒绝（如支付通道繁忙）——提示后解锁，能再点', async () => {
    const page = await mount(path)
    payMock.mockResolvedValue({ ok: false, error: 'UNIFIED_ORDER_FAIL' })
    await page.onPay(ev)
    await page.onPay(ev)
    expect(payMock).toHaveBeenCalledTimes(2)
    expect(wxMock.requestPayment).not.toHaveBeenCalled()
  })

})

describe('收银台报付款成功、回调还没落库（#482）', () => {
  it('大白话：订单详情——解锁，状态卡改成「已付款，正在确认」、按住取消也不会真去取消；30 秒内回来都重拉，回调一到就翻已付', async () => {
    const page = await mount('../pages/order/order')
    page.data.vm = { id: 'o1', status: 'pending', items: [] }
    payMock.mockResolvedValue({ ok: true, payment: PAYMENT })
    await page.onPay()
    wxMock.requestPayment.mock.calls[0][0].success()
    expect(page.data.paying).toBe(false)
    expect(page.data.confirming).toBe(true)
    expect(page.data.head).toBe('已付款，正在确认')
    await page.cancelNow()
    expect(cancelMock).not.toHaveBeenCalled()
    const { FRESH_MS, isFresh } = await import('../utils/fresh') // mount 重置过模块：取页面用的那份
    const t = Date.now()
    expect(isFresh('orders', t + 1000, FRESH_MS, t + 2000)).toBe(false) // 付完 1 秒拉到的（多半还是待付）不算新鲜
  })

  it('大白话：订单列表——解锁，那张卡记成「正在确认」、按住取消也不会真去取消；30 秒内回列表或「我」页都重拉', async () => {
    const page = await mount('../pages/order-list/order-list')
    payMock.mockResolvedValue({ ok: true, payment: PAYMENT })
    await page.onPay({ currentTarget: { dataset: { id: 'o1' } } })
    wxMock.requestPayment.mock.calls[0][0].success()
    expect(page.data.payingId).toBe('')
    expect(page.data.confirmingId).toBe('o1')
    await page.cancelNow('o1')
    expect(cancelMock).not.toHaveBeenCalled()
    const { FRESH_MS, isFresh } = await import('../utils/fresh')
    const t = Date.now()
    expect(isFresh('orders', t + 1000, FRESH_MS, t + 2000)).toBe(false)
    expect(isFresh('orders', t + FRESH_MS + 1000, FRESH_MS, t + FRESH_MS + 2000)).toBe(true) // 保持期过了照常免重拉
  })
})

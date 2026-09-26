// 继续支付（订单详情 / 订单列表）：发起支付在途时连点只发一次 pay、只拉一次收银台，并有加载反馈；
// 支付结束（成功/取消/失败/云端拒）都要解锁，否则用户再也点不动。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { payMock } = vi.hoisted(() => ({ payMock: vi.fn() }))
vi.mock('../api/orders', () => ({
  pay: payMock,
  getOrderById: async () => ({ ok: false, error: 'NOT_FOUND' }),
  getMyOrders: async () => ({ ok: false, error: 'CALL_FAIL' }),
  confirmReceive: vi.fn(),
  cancelOrder: vi.fn(),
  applyRefund: vi.fn(),
  getMyAfterSales: vi.fn(),
}))
vi.mock('../lib/haptics', () => ({ tapHaptic: vi.fn() }))

const PAYMENT = { timeStamp: '1', nonceStr: 'n', package: 'prepay_id=x', signType: 'RSA', paySign: 's' }
let wxMock: Record<string, any>
beforeEach(() => {
  payMock.mockReset()
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

  it('大白话：付成功后也解锁（刷新后若仍显示待付，可再点由云端判已付）', async () => {
    const page = await mount(path)
    payMock.mockResolvedValue({ ok: true, payment: PAYMENT })
    await page.onPay(ev)
    wxMock.requestPayment.mock.calls[0][0].success()
    await page.onPay(ev)
    expect(payMock).toHaveBeenCalledTimes(2)
  })
})

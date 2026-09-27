// 继续支付（订单详情 / 订单列表）：发起支付在途时连点只发一次 pay、只拉一次收银台，并有加载反馈；
// 支付结束（成功/取消/失败/云端拒）都要解锁，否则用户再也点不动。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import orderWxml from '../pages/order/order.wxml?raw'
import orderListWxml from '../pages/order-list/order-list.wxml?raw'

const { payMock, getOrderByIdMock, getMyOrdersMock } = vi.hoisted(() => ({ payMock: vi.fn(), getOrderByIdMock: vi.fn(), getMyOrdersMock: vi.fn() }))
vi.mock('../api/orders', () => ({
  pay: payMock,
  getOrderById: getOrderByIdMock,
  getMyOrders: getMyOrdersMock,
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
  getOrderByIdMock.mockReset().mockResolvedValue({ ok: false, error: 'NOT_FOUND' })
  getMyOrdersMock.mockReset().mockResolvedValue({ ok: false, error: 'CALL_FAIL' })
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

// 绑了 handler 的那个元素渲不渲染：取它的 wx:if 按 data 求值（WXML 表达式是 JS 子集；用了 data 里没有的名字直接抛错）
function rendered(wxml: string, handler: string, scope: Record<string, unknown>): boolean {
  const tag = wxml.match(new RegExp(`<[^>]*:tap="${handler}"[^>]*>`))
  if (!tag) throw new Error('wxml 里找不到 ' + handler)
  const cond = tag[0].match(/wx:if="\{\{([^}]*)\}\}"/)
  return !cond || !!new Function('s', `with (s) { return (${cond[1]}) }`)(scope)
}

const PENDING = { _id: 'o1', status: 'pending', amount: 150, items: [{ lineId: 'L1', name: '小鸭', price: 150, qty: 1 }] }

const PAGES = [
  {
    name: '订单详情',
    path: '../pages/order/order',
    ev: undefined,
    wxml: orderWxml,
    scope: (p: Record<string, any>) => p.data,
    status: (p: Record<string, any>) => p.data.banner.head,
  },
  {
    name: '订单列表',
    path: '../pages/order-list/order-list',
    ev: { currentTarget: { dataset: { id: 'o1' } } },
    wxml: orderListWxml,
    scope: (p: Record<string, any>) => ({ ...p.data, item: p.data.shown[0] }),
    status: (p: Record<string, any>) => {
      const item = p.data.shown[0]
      return new Function('s', 'with (s) { return (' + orderListWxml.match(/class="coolist-status[^"]*">\{\{([^}]*)\}\}/)![1] + ') }')({ ...p.data, item })
    },
  },
]

describe.each(PAGES)('$name 继续支付：在途锁 + 加载反馈', ({ path, ev, wxml, scope, status }) => {
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

  it('大白话：付成功后解锁；刷新后仍显示待付再点，云端判「微信那边其实已付」——订单一直显示「已付款，正在确认」、重新拉订单，不说支付通道繁忙', async () => {
    const page = await mount(path)
    payMock.mockResolvedValue({ ok: true, payment: PAYMENT })
    await page.onPay(ev)
    wxMock.requestPayment.mock.calls[0][0].success()
    payMock.mockResolvedValue({ ok: false, error: 'ORDER_ALREADY_PAID' })
    const reloads = () => getOrderByIdMock.mock.calls.length + getMyOrdersMock.mock.calls.length
    const before = reloads()
    await page.onPay(ev)
    expect(payMock).toHaveBeenCalledTimes(2)
    expect(wxMock.requestPayment).toHaveBeenCalledTimes(1)
    expect(wxMock.showToast.mock.calls.map((c: any[]) => c[0].title)).not.toContain('支付通道繁忙，稍后再试')
    expect(reloads()).toBe(before + 1)
    expect(page.data.paying || page.data.payingId).toBeFalsy()
  })

  it('大白话：云端判已付、重拉回来订单还是待付款（回调没到）——显示「已付款，正在确认」，去支付和取消订单都不出现（取消会把已付的钱关进已关闭单）', async () => {
    getOrderByIdMock.mockResolvedValue({ ok: true, order: PENDING })
    getMyOrdersMock.mockResolvedValue({ ok: true, list: [PENDING], nextCursor: null, hasMore: false })
    const page = await mount(path)
    page.onLoad?.({ id: 'o1' })
    await page.reload()
    expect(rendered(wxml, 'onCancel', scope(page))).toBe(true) // 没判已付前，待付款单照常能取消
    payMock.mockResolvedValue({ ok: false, error: 'ORDER_ALREADY_PAID' })
    await page.onPay(ev)
    await vi.waitFor(() => expect(getOrderByIdMock.mock.calls.length + getMyOrdersMock.mock.calls.length).toBe(2))
    await page.reload() // 之后再刷新（onShow）仍是待付款
    expect(status(page)).toBe('已付款，正在确认')
    expect(rendered(wxml, 'onCancel', scope(page))).toBe(false)
    expect(rendered(wxml, 'onPay', scope(page))).toBe(false)
  })
})

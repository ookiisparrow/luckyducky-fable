// 结算页建单/拉起支付后的去向：成功都进成功页（带订单号与实付分），取消/失败/关闭都弹不可取消的弹窗、
// 点确定回首页。mapPayResult 用真的（纯函数），其余依赖桩掉。Page 桩同 me-cont-failed.test.ts。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { createOrderMock, payMock, goHomeMock } = vi.hoisted(() => ({ createOrderMock: vi.fn(), payMock: vi.fn(), goHomeMock: vi.fn() }))
vi.mock('../api/orders', () => ({ createOrder: createOrderMock, pay: payMock }))
vi.mock('../api/learning', () => ({ trackEvent: vi.fn() }))
vi.mock('../lib/homeIntent', () => ({ goHomeTab: goHomeMock }))
vi.mock('../lib/haptics', () => ({ tapHaptic: vi.fn() }))
vi.mock('../lib/address', () => ({ defaultAddress: vi.fn() }))
vi.mock('../lib/cart', () => ({ freshCover: vi.fn() }))
vi.mock('../lib/catalog', () => ({ getAllProducts: vi.fn() }))
// resolveOrderAmountFen 用真的：云端 order.amount 是元，桩成原样返回会让「漏掉元转分」恒绿。
vi.mock('../lib/checkout', async (importOriginal) => ({
  resolveOrderAmountFen: (await importOriginal<typeof import('../lib/checkout')>()).resolveOrderAmountFen,
  sellableAddons: () => [],
  getDraft: () => ({ items: [{ id: 'p1', sku: '', qty: 1 }], fromCart: false }),
  summaryFen: () => ({ amountFen: 999 }),
  getIdemKey: () => 'k1',
  finishSubmitted: vi.fn(),
  mapCreateOrderError: (e: string) => e,
}))

let pageOpts: Record<string, any> = {}
;(globalThis as any).Page = (o: unknown) => {
  pageOpts = o as Record<string, any>
}

async function mount(): Promise<Record<string, any>> {
  vi.resetModules()
  await import('../pages/checkout/checkout')
  const page = Object.create(pageOpts) as Record<string, any>
  page.data = { ...pageOpts.data }
  page.setData = function (patch: Record<string, unknown>) {
    Object.assign(this.data as Record<string, unknown>, patch)
  }
  return page
}

const SUCCESS_URL = '/pages/paysuccess/paysuccess?id=o1&amount=12800'
const PAYMENT = { timeStamp: '1', nonceStr: 'n', package: 'prepay_id=x', signType: 'RSA', paySign: 's' }
let wxMock: Record<string, any>

beforeEach(() => {
  createOrderMock.mockReset()
  payMock.mockReset()
  goHomeMock.mockReset()
  wxMock = { redirectTo: vi.fn(), showModal: vi.fn(), showToast: vi.fn(), requestPayment: vi.fn() }
  ;(globalThis as any).wx = wxMock
})

function modalShown() {
  expect(wxMock.showModal).toHaveBeenCalledTimes(1)
  const opts = wxMock.showModal.mock.calls[0][0]
  expect(opts.showCancel).toBe(false)
  expect(goHomeMock).not.toHaveBeenCalled()
  opts.success({ confirm: true })
  expect(goHomeMock).toHaveBeenCalledTimes(1)
  expect(wxMock.redirectTo).not.toHaveBeenCalled()
  return { title: opts.title, content: opts.content }
}

describe('结算页：建单即付进成功页', () => {
  it('大白话：建单回来已是已付（开发环境直付）——直接进成功页，带订单号与云端实付（元换成分），不再拉支付', async () => {
    createOrderMock.mockResolvedValue({ ok: true, order: { id: 'o1', status: 'paid', amount: 128 } }) // 云端 amount 单位是元
    const page = await mount()
    page.data.address = { name: 'a', phone: 'p', region: 'r', detail: 'd' }
    await page.onSubmit()
    expect(payMock).not.toHaveBeenCalled()
    expect(wxMock.redirectTo).toHaveBeenCalledWith({ url: SUCCESS_URL })
  })
})

describe('结算页 startPay：每种支付结果的去向', () => {
  it('大白话：云端说已付——直接进成功页', async () => {
    payMock.mockResolvedValue({ ok: true, paid: true })
    const page = await mount()
    await page.startPay('o1', 12800)
    expect(wxMock.redirectTo).toHaveBeenCalledWith({ url: SUCCESS_URL })
    expect(wxMock.requestPayment).not.toHaveBeenCalled()
  })

  it('大白话：拉起收银台付成功——进成功页', async () => {
    payMock.mockResolvedValue({ ok: true, payment: PAYMENT })
    const page = await mount()
    await page.startPay('o1', 12800)
    const opts = wxMock.requestPayment.mock.calls[0][0]
    expect(opts).toMatchObject(PAYMENT)
    opts.success()
    expect(wxMock.redirectTo).toHaveBeenCalledWith({ url: SUCCESS_URL })
  })

  it('大白话：收银台里点了取消——弹「支付已取消」，订单保留，点确定回首页', async () => {
    payMock.mockResolvedValue({ ok: true, payment: PAYMENT })
    const page = await mount()
    await page.startPay('o1', 12800)
    wxMock.requestPayment.mock.calls[0][0].fail({ errMsg: 'requestPayment:fail cancel' })
    expect(modalShown()).toEqual({ title: '支付已取消', content: '订单已保留，超时前都可以继续支付。可到「我的-我的订单」继续支付。' })
  })

  it('大白话：收银台里付失败（非取消）——弹「支付没成功」，同样保留订单、点确定回首页', async () => {
    payMock.mockResolvedValue({ ok: true, payment: PAYMENT })
    const page = await mount()
    await page.startPay('o1', 12800)
    wxMock.requestPayment.mock.calls[0][0].fail({ errMsg: 'requestPayment:fail' })
    expect(modalShown()).toEqual({ title: '支付没成功', content: '订单已保留，超时前都可以继续支付。可到「我的-我的订单」继续支付。' })
  })

  it('大白话：订单已超时关闭——弹「订单已关闭」带云端原因，点确定回首页', async () => {
    payMock.mockResolvedValue({ ok: false, error: 'ORDER_CLOSED' })
    const page = await mount()
    await page.startPay('o1', 12800)
    expect(modalShown()).toEqual({ title: '订单已关闭', content: '订单已超时关闭，请重新下单' })
  })

  it('大白话：其它支付错误——弹「支付没成功」带原因，点确定回首页', async () => {
    payMock.mockResolvedValue({ ok: false, error: 'PAY_NOT_ENABLED' })
    const page = await mount()
    await page.startPay('o1', 12800)
    expect(modalShown()).toEqual({ title: '支付没成功', content: '支付暂未开通' })
  })
})

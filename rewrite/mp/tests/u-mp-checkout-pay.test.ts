// 结算页建单/拉起支付后的去向：成功都进成功页（带订单号与实付分）；取消/支付出错都落到该订单详情（拍板 4/A）；
// 订单已关闭弹窗后回首页。mapPayResult 用真的（纯函数），其余依赖桩掉。Page 桩同 me-cont-failed.test.ts。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import limitsSrc from '../../shared/src/limits.ts?raw'

// 「15 分钟」是云端付款时限 PAY_WINDOW_MS（小程序进不了 shared，文案手抄）：云端改时限这里就红
const PAY_WINDOW_MIN = (() => {
  const m = limitsSrc.match(/PAY_WINDOW_MS = (\d+) \* 60 \* 1000/)
  if (!m) throw new Error('shared/limits 找不到 PAY_WINDOW_MS')
  return Number(m[1])
})()

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

// 拍板 A：支付出错（非取消）——订单保留，弹窗说明后换到这张订单的详情页（在那里可继续支付），不回首页
// 页面桩没挂 px-fx：只一颗「知道了」的确认半屏走 utils/sysUi 原生兜底（showCancel:false）；点了之后的去向在 then 里（异步）
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}
async function modalToOrder() {
  expect(wxMock.showModal).toHaveBeenCalledTimes(1)
  const opts = wxMock.showModal.mock.calls[0][0]
  expect(opts.showCancel).toBe(false)
  expect(opts.confirmText).toBe('知道了')
  expect(opts.title).not.toBe(opts.content)
  expect(opts.content).toContain('订单已保留，可在订单详情里继续支付')
  expect(wxMock.redirectTo).not.toHaveBeenCalled()
  opts.success({ confirm: true })
  await flush()
  expect(wxMock.redirectTo).toHaveBeenCalledWith({ url: '/pages/order/order?id=o1' })
  expect(goHomeMock).not.toHaveBeenCalled()
  return { title: opts.title, content: opts.content }
}

async function modalShown() {
  expect(wxMock.showModal).toHaveBeenCalledTimes(1)
  const opts = wxMock.showModal.mock.calls[0][0]
  expect(opts.showCancel).toBe(false)
  expect(goHomeMock).not.toHaveBeenCalled()
  opts.success({ confirm: true })
  await flush()
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

  it('大白话：收银台里点了取消（老板拍板 4）——提示「订单已保存，请在 15 分钟内支付」并换到这张订单的详情页，不弹窗不回首页', async () => {
    payMock.mockResolvedValue({ ok: true, payment: PAYMENT })
    const page = await mount()
    await page.startPay('o1', 12800)
    wxMock.requestPayment.mock.calls[0][0].fail({ errMsg: 'requestPayment:fail cancel' })
    expect(wxMock.showToast).toHaveBeenCalledWith(expect.objectContaining({ title: `订单已保存，请在 ${PAY_WINDOW_MIN} 分钟内支付`, icon: 'none' }))
    expect(wxMock.redirectTo).toHaveBeenCalledWith({ url: '/pages/order/order?id=o1' })
    expect(wxMock.showModal).not.toHaveBeenCalled()
    expect(goHomeMock).not.toHaveBeenCalled()
  })

  it('大白话：收银台里付失败（非取消·拍板 A）——弹「支付没成功」说明订单已保留，点确定换到这张订单的详情页', async () => {
    payMock.mockResolvedValue({ ok: true, payment: PAYMENT })
    const page = await mount()
    await page.startPay('o1', 12800)
    wxMock.requestPayment.mock.calls[0][0].fail({ errMsg: 'requestPayment:fail' })
    expect((await modalToOrder()).title).toBe('支付没成功')
  })

  it('大白话：订单已超时关闭——弹「订单已关闭」带云端原因，点确定回首页', async () => {
    payMock.mockResolvedValue({ ok: false, error: 'ORDER_CLOSED' })
    const page = await mount()
    await page.startPay('o1', 12800)
    expect(await modalShown()).toEqual({ title: '订单已关闭', content: '订单已超时关闭，请重新下单' })
  })

  it('大白话：拉支付参数失败（拍板 A）——弹「支付没成功」带原因和「订单已保留」，点确定换到订单详情', async () => {
    payMock.mockResolvedValue({ ok: false, error: 'PAY_NOT_ENABLED' })
    const page = await mount()
    await page.startPay('o1', 12800)
    const m = await modalToOrder()
    expect(m.title).toBe('支付没成功')
    expect(m.content).toContain('支付暂未开通')
  })

  it('大白话：云端说不出原因的支付失败——正文不再和标题重复「支付没成功」', async () => {
    payMock.mockResolvedValue({ ok: false, error: 'WEIRD' })
    const page = await mount()
    await page.startPay('o1', 12800)
    expect((await modalToOrder()).content).not.toContain('支付没成功')
  })

  it('大白话：调支付参数期间按键显示「正在拉起支付」转圈，回来后收掉', async () => {
    let release!: (v: unknown) => void
    payMock.mockReturnValue(new Promise((r) => (release = r)))
    const page = await mount()
    page.data.submitted = true
    const p = page.startPay('o1', 12800)
    expect(page.data.paying).toBe(true)
    expect(page.data.submitted).toBe(false)
    release({ ok: true, payment: PAYMENT })
    await p
    expect(page.data.paying).toBe(false)
  })
})

// 结算页主路径行为：渲染草稿与金额、空草稿提示并延时退回（等转场落地才起表）、选地址/搭配购的提交在途闸、
// 缺地址、建单失败可重试（同一幂等键）、建单成功扣车并拉支付、提交在途退页的收尾。
// 草稿/购物车/地址用真的（wx 存储桩），只桩云调用。Page 桩同 me-cont-failed.test.ts。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { createOrderMock, payMock, goHomeMock, getAllProductsMock } = vi.hoisted(() => ({
  createOrderMock: vi.fn(),
  payMock: vi.fn(),
  goHomeMock: vi.fn(),
  getAllProductsMock: vi.fn(),
}))
vi.mock('../api/orders', () => ({ createOrder: createOrderMock, pay: payMock }))
vi.mock('../api/learning', () => ({ trackEvent: vi.fn() }))
vi.mock('../lib/haptics', () => ({ tapHaptic: vi.fn() }))
vi.mock('../lib/catalog', () => ({ getAllProducts: getAllProductsMock }))
vi.mock('../lib/homeIntent', () => ({ goHomeTab: goHomeMock }))

let storage: Record<string, unknown> = {}
let wxMock: Record<string, any>
let ck: typeof import('../lib/checkout')
let cart: typeof import('../lib/cart')

beforeEach(() => {
  storage = {}
  wxMock = {
    getStorageSync: (k: string) => storage[k],
    setStorageSync: (k: string, v: unknown) => (storage[k] = JSON.parse(JSON.stringify(v))),
    showToast: vi.fn(),
    showModal: vi.fn(),
    navigateBack: vi.fn(),
    navigateTo: vi.fn(),
    redirectTo: vi.fn(),
    requestPayment: vi.fn(),
  }
  ;(globalThis as any).wx = wxMock
  createOrderMock.mockReset()
  payMock.mockReset()
  goHomeMock.mockReset()
  getAllProductsMock.mockReset()
  getAllProductsMock.mockImplementation(async () => [{ id: 'p1', images: ['https://img/fresh.png'] }])
})
afterEach(() => {
  vi.useRealTimers()
})

type Seed = 'cart' | 'empty'
async function mount(seed: Seed = 'cart', withAddress = true): Promise<Record<string, any>> {
  let opts: Record<string, any> = {}
  ;(globalThis as any).Page = (o: Record<string, any>) => (opts = o)
  vi.resetModules()
  ck = await import('../lib/checkout')
  cart = await import('../lib/cart')
  if (withAddress) (await import('../lib/address')).saveAddress({ name: '鸭', phone: '13800000000', region: '上海', detail: '1 号', isDefault: true })
  if (seed === 'cart') {
    cart.add({ id: 'p1', name: '小鸭', price: 128 })
    cart.add({ id: 'p1', name: '小鸭', price: 128 })
    cart.add({ id: 'p2', name: '云朵鸭', price: 22 })
    ck.prepareFromCart()
  }
  await import('../pages/checkout/checkout')
  const page = Object.create(opts) as Record<string, any>
  page.data = { ...opts.data }
  page.setData = function (patch: Record<string, unknown>) {
    Object.assign(this.data as Record<string, unknown>, patch)
  }
  return page
}

describe('结算页：渲染', () => {
  it('大白话：进页画出默认地址、条目两位小数单价、合计件数与实付；包邮', async () => {
    const page = await mount()
    page.onShow()
    await vi.waitFor(() => expect(page.data.count).toBe(3))
    expect(page.data.address).toMatchObject({ name: '鸭', phone: '13800000000' })
    expect(page.data.items.map((l: any) => [l.id, l.qty, l.priceNum])).toEqual([
      ['p1', 2, '128.00'],
      ['p2', 1, '22.00'],
    ])
    expect(page.data).toMatchObject({ goodsLabel: '¥278.00', shipLabel: '包邮', amountNum: '278.00' })
  })

  it('大白话：勾搭配购改草稿并重算；提交在途时既不能改搭配购也不能跳地址页', async () => {
    const page = await mount()
    await page.refresh()
    page.onToggleAddon({ currentTarget: { dataset: { id: 'hook' } } })
    await vi.waitFor(() => expect(page.data.count).toBe(4))
    expect(page.data.amountNum).toBe('317.00')
    page.onPickAddress()
    expect(wxMock.navigateTo).toHaveBeenCalledWith({ url: '/pages/address/address?pick=1' })

    page.data.submitting = true
    page.onToggleAddon({ currentTarget: { dataset: { id: 'hook' } } })
    page.onPickAddress()
    await page.refresh()
    expect(ck.getDraft().items.map((l) => l.id)).toEqual(['p1', 'p2', 'hook'])
    expect(wxMock.navigateTo).toHaveBeenCalledTimes(1)
  })
})

describe('结算页：地址卡展示（v5 A5）', () => {
  it('大白话：姓名和打码手机号一行「鸭 · 138 **** 0428」；省市区去掉空格和详址连起来；下单仍用原始手机号和地区', async () => {
    const page = await mount('cart', false)
    ;(await import('../lib/address')).saveAddress({ name: '鸭', phone: '13800000428', region: '上海市 上海市 徐汇区', detail: '漕溪北路 1 号', isDefault: true })
    await page.refresh()
    expect(page.data.address).toMatchObject({ who: '鸭 · 138 **** 0428', where: '上海市上海市徐汇区漕溪北路 1 号' })
    createOrderMock.mockResolvedValue({ ok: false, error: 'CALL_TIMEOUT' })
    await page.onSubmit()
    expect(createOrderMock.mock.calls[0][1]).toEqual({ name: '鸭', phone: '13800000428', region: '上海市 上海市 徐汇区', detail: '漕溪北路 1 号' })
  })
})

describe('结算页：空草稿', () => {
  it('大白话：转场还没落地就发现空草稿——先提示，等 onReady 后再 600ms 退回', async () => {
    vi.useFakeTimers()
    const page = await mount('empty')
    await page.refresh()
    expect(wxMock.showToast).toHaveBeenCalledWith({ title: '还没有要结算的商品', icon: 'none' })
    vi.advanceTimersByTime(2000)
    expect(wxMock.navigateBack).not.toHaveBeenCalled()
    page.onReady()
    vi.advanceTimersByTime(599)
    expect(wxMock.navigateBack).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(wxMock.navigateBack).toHaveBeenCalledTimes(1)
  })

  it('大白话：已就绪时立刻起表；表没到就退页——清掉，不再对下一页退回', async () => {
    vi.useFakeTimers()
    const page = await mount('empty')
    page.onReady()
    await page.refresh()
    page.onUnload()
    vi.advanceTimersByTime(1000)
    expect(wxMock.navigateBack).not.toHaveBeenCalled()
    await page.refresh() // 已退页：不再提示
    expect(wxMock.showToast).toHaveBeenCalledTimes(1)
  })
})

describe('结算页：提交', () => {
  it('大白话：没有收货地址——提示先添加，不建单', async () => {
    const page = await mount('cart', false)
    await page.refresh()
    await page.onSubmit()
    expect(wxMock.showToast).toHaveBeenCalledWith({ title: '先添加收货地址', icon: 'none' })
    expect(createOrderMock).not.toHaveBeenCalled()
  })

  it('大白话：建单失败（网络）——如实提示并解锁；再点提交用同一个幂等键，不会重复建单', async () => {
    const page = await mount()
    await page.refresh()
    createOrderMock.mockResolvedValue({ ok: false, error: 'CALL_TIMEOUT' })
    await page.onSubmit()
    expect(createOrderMock).toHaveBeenCalledWith(
      [
        { id: 'p1', sku: '', qty: 2 },
        { id: 'p2', sku: '', qty: 1 },
      ],
      { name: '鸭', phone: '13800000000', region: '上海', detail: '1 号' },
      expect.any(String)
    )
    expect(wxMock.showToast).toHaveBeenLastCalledWith({ title: '网络不好，稍后再试', icon: 'none' })
    expect(page.data.submitting).toBe(false)
    await page.onSubmit()
    expect(createOrderMock.mock.calls[1][2]).toBe(createOrderMock.mock.calls[0][2])
    expect(createOrderMock.mock.calls[0][2]).not.toBe('')
  })

  it('大白话：有一件下架被移走、还剩别的——弹窗说其余可继续下单，并重画剩下的商品', async () => {
    const page = await mount()
    await page.refresh()
    createOrderMock.mockResolvedValue({ ok: false, error: 'UNLISTED_ITEM:p2' })
    await page.onSubmit()
    expect(wxMock.showModal.mock.calls[0][0].content).toBe('「云朵鸭」现在买不了，已从本单移除，其余商品可以继续下单。')
    await vi.waitFor(() => expect(page.data.items.map((l: any) => l.id)).toEqual(['p1']))
    wxMock.showModal.mock.calls[0][0].success()
    expect(wxMock.navigateBack).not.toHaveBeenCalled()
  })

  it('大白话：建单成功待支付——扣掉购物车里提交的数量、草稿清空，锁保持，接着拉支付', async () => {
    const page = await mount()
    await page.refresh()
    createOrderMock.mockResolvedValue({ ok: true, order: { id: 'o9', status: 'pending', amount: 278 } })
    payMock.mockResolvedValue({ ok: false, error: 'PAY_NOT_ENABLED' })
    await page.onSubmit()
    expect(payMock).toHaveBeenCalledWith('o9')
    expect(cart.getItems()).toEqual([])
    expect(ck.getDraft().items).toEqual([])
    expect(page.data.submitting).toBe(true)
    await page.onSubmit()
    expect(createOrderMock).toHaveBeenCalledTimes(1) // 锁住：不会二次建单

    // 从微信收银台切回来触发 onShow：草稿已清空，但支付在途——不能报「没商品」也不能把本页退掉
    vi.useFakeTimers()
    page.onReady()
    page.onShow()
    await Promise.resolve()
    vi.advanceTimersByTime(1000)
    expect(wxMock.showToast).not.toHaveBeenCalledWith({ title: '还没有要结算的商品', icon: 'none' })
    expect(wxMock.navigateBack).not.toHaveBeenCalled()
  })

  it('大白话：建单成功——按键先打勾「已提交」停 0.6 秒再拉支付；支付只发一次，期间连点不会再建单', async () => {
    vi.useFakeTimers()
    const page = await mount()
    await page.refresh()
    createOrderMock.mockResolvedValue({ ok: true, order: { id: 'o9', status: 'pending', amount: 278 } })
    payMock.mockResolvedValue({ ok: false, error: 'PAY_NOT_ENABLED' })
    const p = page.onSubmit()
    await vi.advanceTimersByTimeAsync(599)
    expect(page.data.submitted).toBe(true)
    expect(payMock).not.toHaveBeenCalled()
    await page.onSubmit()
    await vi.advanceTimersByTimeAsync(1)
    await p
    expect(payMock).toHaveBeenCalledTimes(1)
    expect(payMock).toHaveBeenCalledWith('o9')
    expect(createOrderMock).toHaveBeenCalledTimes(1)
  })

  it('大白话：刷新等商品数据期间用户点了提交（草稿被清空）——刷新回来不能拿空草稿重画页面', async () => {
    const page = await mount()
    await page.refresh()
    expect(page.data.count).toBe(3)
    let release!: (v: unknown) => void
    getAllProductsMock.mockReturnValueOnce(new Promise((r) => (release = r)))
    const pending = page.refresh()
    createOrderMock.mockResolvedValue({ ok: true, order: { id: 'o9', status: 'pending', amount: 278 } })
    payMock.mockResolvedValue({ ok: false, error: 'PAY_NOT_ENABLED' })
    await page.onSubmit()
    expect(ck.getDraft().items).toEqual([])
    release([{ id: 'p1', images: ['https://img/fresh.png'] }])
    await pending
    expect(page.data.count).toBe(3)
    expect(page.data.items.map((l: any) => l.id)).toEqual(['p1', 'p2'])
    expect(page.data.amountNum).toBe('278.00')
  })

  it('大白话：建单在途时退出了结算页——成功也照样扣车清草稿，只轻提示，不跳页不拉支付', async () => {
    const page = await mount()
    await page.refresh()
    let release!: (v: unknown) => void
    createOrderMock.mockReturnValue(new Promise((r) => (release = r)))
    const p = page.onSubmit()
    page.onUnload()
    release({ ok: true, order: { id: 'o9', status: 'pending', amount: 278 } })
    await p
    expect(cart.getItems()).toEqual([])
    expect(ck.getDraft().items).toEqual([])
    expect(wxMock.showToast).toHaveBeenCalledWith({ title: '订单已生成，可到订单列表继续支付', icon: 'none' })
    expect(payMock).not.toHaveBeenCalled()
    expect(wxMock.redirectTo).not.toHaveBeenCalled()
  })

  it('大白话：建单在途退页且建单失败——什么都不动（草稿和购物车原样，不提示）', async () => {
    const page = await mount()
    await page.refresh()
    let release!: (v: unknown) => void
    createOrderMock.mockReturnValue(new Promise((r) => (release = r)))
    const p = page.onSubmit()
    page.onUnload()
    release({ ok: false, error: 'CALL_FAIL' })
    await p
    expect(ck.getDraft().items).toHaveLength(2)
    expect(cart.getItems()).toHaveLength(2)
    expect(wxMock.showToast).not.toHaveBeenCalled()
  })

  it('大白话：拉支付在途时退出了结算页——不拉收银台，只提示去订单列表继续支付', async () => {
    const page = await mount()
    let release!: (v: unknown) => void
    payMock.mockReturnValue(new Promise((r) => (release = r)))
    const p = page.startPay('o9', 27800)
    page.onUnload()
    release({ ok: true, payment: { timeStamp: '1', nonceStr: 'n', package: 'prepay_id=x', signType: 'RSA', paySign: 's' } })
    await p
    expect(wxMock.requestPayment).not.toHaveBeenCalled()
    expect(wxMock.showToast).toHaveBeenCalledWith({ title: '订单已生成，可到订单列表继续支付', icon: 'none' })
  })
})

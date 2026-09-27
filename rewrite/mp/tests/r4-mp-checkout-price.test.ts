// 结算页价格对齐现价：购物车/立即购买记的是加购那一刻的单价，后台改价后结算页照旧显示旧价、标「实付款」，
// 真正扣多少只有到微信收银台才看得出。现在进页用已拉到的商品数据刷新单价与合计（变了明确提示），建单带上
// 页面显示的应付额；云端现价对不上回 PRICE_CHANGED（带现价应付分），页面按它刷新并提示确认后再付。
// 草稿/购物车/地址用真的（wx 存储桩），只桩云调用与目录。Page 桩同 p-mp-checkout-page.test.ts。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { createOrderMock, payMock, getAllProductsMock } = vi.hoisted(() => ({
  createOrderMock: vi.fn(),
  payMock: vi.fn(),
  getAllProductsMock: vi.fn(),
}))
vi.mock('../api/orders', () => ({ createOrder: createOrderMock, pay: payMock }))
vi.mock('../api/learning', () => ({ trackEvent: vi.fn() }))
vi.mock('../lib/haptics', () => ({ tapHaptic: vi.fn() }))
vi.mock('../lib/catalog', () => ({ getAllProducts: getAllProductsMock }))
vi.mock('../lib/homeIntent', () => ({ goHomeTab: vi.fn() }))

let storage: Record<string, unknown> = {}
let wxMock: Record<string, any>
let cart: typeof import('../lib/cart')

const P1 = { id: 'p1', name: '小鸭', price: 128 }
const P2 = { id: 'p2', name: '云朵鸭', price: 22 }
let live: Record<string, unknown>[] | null

beforeEach(() => {
  storage = {}
  wxMock = {
    getStorageSync: (k: string) => storage[k],
    setStorageSync: (k: string, v: unknown) => (storage[k] = JSON.parse(JSON.stringify(v))),
    showToast: vi.fn(),
    showModal: vi.fn(),
    navigateBack: vi.fn(),
    redirectTo: vi.fn(),
    requestPayment: vi.fn(),
  }
  ;(globalThis as any).wx = wxMock
  createOrderMock.mockReset()
  payMock.mockReset()
  live = [P1, P2]
  getAllProductsMock.mockReset().mockImplementation(async () => live)
})

async function mount(): Promise<Record<string, any>> {
  let opts: Record<string, any> = {}
  ;(globalThis as any).Page = (o: Record<string, any>) => (opts = o)
  vi.resetModules()
  const ck = await import('../lib/checkout')
  cart = await import('../lib/cart')
  ;(await import('../lib/address')).saveAddress({ name: '鸭', phone: '13800000000', region: '上海', detail: '1 号', isDefault: true })
  cart.add({ ...P1 })
  cart.add({ ...P1 })
  cart.add({ ...P2 })
  cart.add({ id: 'p3', sku: '红', name: '彩鸭', price: 50 })
  ck.prepareFromCart()
  await import('../pages/checkout/checkout')
  const page = Object.create(opts) as Record<string, any>
  page.data = { ...opts.data }
  page.setData = function (patch: Record<string, unknown>) {
    Object.assign(this.data as Record<string, unknown>, patch)
  }
  return page
}

const price = (page: Record<string, any>, id: string) => page.data.items.find((l: any) => l.id === id).priceNum
const modalTitles = () => wxMock.showModal.mock.calls.map((c: any[]) => c[0].title)
const P3 = (red: number) => ({ id: 'p3', name: '彩鸭', price: 50, skus: [{ name: '红', price: red }, { name: '蓝', price: 70 }] })

describe('结算页：进页按现价刷新', () => {
  it('大白话：商品改价了——单价、商品金额、应付都换成现价，弹一次「价格有变」；购物车里记的价也跟着更新', async () => {
    live = [{ ...P1, price: 138 }, P2, P3(55)]
    const page = await mount()
    await page.refresh()
    expect(price(page, 'p1')).toBe('138.00')
    expect(price(page, 'p3')).toBe('55.00') // 带规格的按规格价
    expect(page.data).toMatchObject({ goodsLabel: '¥353.00', amountNum: '353.00' })
    expect(modalTitles()).toEqual(['价格有变，请确认后再付款'])
    expect(cart.getItems().map((it) => [it.id, it.price])).toEqual([
      ['p1', 138],
      ['p2', 22],
      ['p3', 55],
    ])
    await page.refresh() // 再进一次页：已是现价，不再弹
    expect(wxMock.showModal).toHaveBeenCalledTimes(1)
  })

  it('大白话：价没变——不弹提示', async () => {
    live = [P1, P2, P3(50)]
    const page = await mount()
    await page.refresh()
    expect(page.data.amountNum).toBe('328.00')
    expect(wxMock.showModal).not.toHaveBeenCalled()
  })

  it('大白话：现价数据残缺（没价/价为 0/缺名/规格没了/目录没拉到）——保留原单价，不瞎改（真买不了由云端拒单）', async () => {
    live = [{ id: 'p1', name: '小鸭' }, { ...P2, price: 0 }, { id: 'p3', name: '彩鸭', price: 50, skus: [{ name: '蓝', price: 70 }] }]
    const page = await mount()
    await page.refresh()
    expect(page.data.amountNum).toBe('328.00')
    live = null
    await page.refresh()
    expect(page.data.amountNum).toBe('328.00')
    expect(wxMock.showModal).not.toHaveBeenCalled()
  })
})

describe('结算页：建单带应付额，云端说价变了就按云端的刷新', () => {
  it('大白话：提交时把页面显示的应付（分）一起带给云端', async () => {
    live = [{ ...P1, price: 138 }, P2, P3(50)]
    const page = await mount()
    await page.refresh()
    createOrderMock.mockResolvedValue({ ok: false, error: 'CALL_TIMEOUT' })
    await page.onSubmit()
    expect(createOrderMock.mock.calls[0][3]).toBe(34800)
  })

  it('大白话：云端回 PRICE_CHANGED——强刷目录、应付按云端给的现价显示、只弹一次「价格有变，请确认后再付款」；再提交带上云端这个数', async () => {
    const page = await mount()
    await page.refresh()
    live = [{ ...P1, price: 148 }, P2, P3(50)]
    createOrderMock.mockResolvedValueOnce({ ok: false, error: 'PRICE_CHANGED', amountFen: 36800 })
    await page.onSubmit()
    expect(getAllProductsMock).toHaveBeenLastCalledWith({ force: true })
    expect(price(page, 'p1')).toBe('148.00')
    expect(page.data).toMatchObject({ amountNum: '368.00', submitting: false })
    expect(modalTitles()).toEqual(['价格有变，请确认后再付款'])
    expect(wxMock.showModal.mock.calls[0][0].content).toContain('¥368.00')
    createOrderMock.mockResolvedValueOnce({ ok: false, error: 'CALL_TIMEOUT' })
    await page.onSubmit()
    expect(createOrderMock.mock.calls[1][3]).toBe(36800)
  })

  it('大白话：云端说价变了、目录还在强刷——按钮放开时页面已显示云端的新应付并已弹提示；这时再点提交，带的就是页面上这个数，目录回来后也不再补弹', async () => {
    const page = await mount()
    await page.refresh()
    let release!: (v: unknown) => void
    getAllProductsMock.mockImplementationOnce(() => new Promise((r) => (release = r)))
    createOrderMock.mockResolvedValueOnce({ ok: false, error: 'PRICE_CHANGED', amountFen: 36800 })
    const first = page.onSubmit()
    await vi.waitFor(() => expect(getAllProductsMock).toHaveBeenLastCalledWith({ force: true }))
    expect(page.data).toMatchObject({ amountNum: '368.00', submitting: false })
    expect(modalTitles()).toEqual(['价格有变，请确认后再付款'])
    createOrderMock.mockResolvedValueOnce({ ok: true, order: { id: 'o9', status: 'paid', amount: 368 } })
    await page.onSubmit()
    expect(createOrderMock.mock.calls[1][3]).toBe(36800)
    release([{ ...P1, price: 148 }, P2, P3(50)])
    await first
    expect(wxMock.showModal).toHaveBeenCalledTimes(1)
  })

  it('大白话：云端说价变了但目录没刷到新价——应付照云端给的数显示，再提交也带云端的数（不会一直被拒）', async () => {
    const page = await mount()
    await page.refresh()
    live = null
    createOrderMock.mockResolvedValueOnce({ ok: false, error: 'PRICE_CHANGED', amountFen: 35000 })
    await page.onSubmit()
    expect(page.data.amountNum).toBe('350.00')
    createOrderMock.mockResolvedValueOnce({ ok: false, error: 'CALL_TIMEOUT' })
    await page.onSubmit()
    expect(createOrderMock.mock.calls[1][3]).toBe(35000)
  })

  it('大白话：之后改了搭配购——草稿变了，云端那个数作废，按本地重算', async () => {
    const page = await mount()
    await page.refresh()
    live = null
    createOrderMock.mockResolvedValueOnce({ ok: false, error: 'PRICE_CHANGED', amountFen: 35000 })
    await page.onSubmit()
    page.onToggleAddon({ currentTarget: { dataset: { id: 'hook' } } })
    await vi.waitFor(() => expect(page.data.count).toBe(5))
    expect(page.data.amountNum).toBe('367.00')
  })
})

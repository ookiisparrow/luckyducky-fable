// 结算失败提示：云端拒单码要说清是哪类问题；商品下架/删档/规格没了要把那一行移出本单和购物车，
// 让用户能接着下单，而不是每次都「稍后再试」卡死。结算页用真的 checkout/cart，只桩云调用。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as cart from '../lib/cart'
import * as checkout from '../lib/checkout'

const { createOrderMock } = vi.hoisted(() => ({ createOrderMock: vi.fn() }))
vi.mock('../api/orders', () => ({ createOrder: createOrderMock, pay: vi.fn() }))
vi.mock('../api/learning', () => ({ trackEvent: vi.fn() }))
vi.mock('../lib/haptics', () => ({ tapHaptic: vi.fn() }))
vi.mock('../lib/catalog', () => ({ getAllProducts: async () => [] }))

let storage: Record<string, unknown> = {}
let wxMock: Record<string, any>
beforeEach(() => {
  storage = {}
  wxMock = {
    getStorageSync: (k: string) => storage[k],
    setStorageSync: (k: string, v: unknown) => (storage[k] = JSON.parse(JSON.stringify(v))),
    showToast: vi.fn(),
    showModal: vi.fn(),
    navigateBack: vi.fn(),
  }
  ;(globalThis as any).wx = wxMock
  cart.__resetForTest()
  checkout.__resetForTest()
  createOrderMock.mockReset()
})

const GENERIC = '下单没成功，稍后再试'

describe('建单失败文案：每类拒单各说各的', () => {
  it('大白话：下架/没这件/规格没了/待付单太多/地址不对/数量超限/太频繁/网络不好都不是「稍后再试」', () => {
    const codes = ['UNLISTED_ITEM:p1', 'UNKNOWN_ITEM:p1', 'UNKNOWN_SKU:p1:白', 'TOO_MANY_PENDING', 'BAD_ADDRESS', 'BAD_QTY', 'RATE_LIMITED', 'CALL_TIMEOUT', 'CALL_FAIL']
    for (const c of codes) expect(checkout.mapCreateOrderError(c), c).not.toBe(GENERIC)
    expect(checkout.mapCreateOrderError('UNLISTED_ITEM:p1')).toContain('下架')
    expect(checkout.mapCreateOrderError('TOO_MANY_PENDING')).toContain('我的订单')
    expect(checkout.mapCreateOrderError('BAD_ADDRESS')).toContain('地址')
    expect(checkout.mapCreateOrderError('BAD_QTY')).toContain('数量')
    expect(checkout.mapCreateOrderError('OUT_OF_STOCK:p1:')).toBe('有商品库存不足') // 原有映射不变
    expect(checkout.mapCreateOrderError('SOMETHING_NEW')).toBe(GENERIC)
  })
})

describe('买不了的那一行移出本单和购物车', () => {
  function seed() {
    cart.add({ id: 'p1', name: '小鸭', price: 128 })
    cart.add({ id: 'p2', sku: '白', name: '云朵鸭', price: 22 })
    cart.add({ id: 'p2', sku: '黄', name: '云朵鸭', price: 22 })
    checkout.prepareFromCart()
  }
  it('大白话：商品下架——整件（各规格）从草稿和购物车移走，回报商品名', () => {
    seed()
    expect(checkout.dropRejectedLine('UNLISTED_ITEM:p2')).toBe('云朵鸭')
    expect(checkout.getDraft().items.map((l) => l.id)).toEqual(['p1'])
    expect(cart.getItems().map((l) => l.id)).toEqual(['p1'])
  })
  it('大白话：规格没了——只移这个规格那一行（回报名字带规格），同商品别的规格留着', () => {
    seed()
    expect(checkout.dropRejectedLine('UNKNOWN_SKU:p2:白')).toBe('云朵鸭（白）')
    expect(checkout.getDraft().items.map((l) => l.lineId)).toEqual(['p1__', 'p2__黄'])
    expect(cart.getItems().map((l) => l.lineId)).toEqual(['p1__', 'p2__黄'])
  })
  it('大白话：立即购买不动购物车；别的错误码一行都不动', () => {
    cart.add({ id: 'p1', name: '小鸭', price: 128 })
    checkout.prepareBuyNow({ id: 'p1', name: '小鸭', price: 128 })
    expect(checkout.dropRejectedLine('OUT_OF_STOCK:p1:')).toBe('')
    expect(checkout.getDraft().items).toHaveLength(1)
    expect(checkout.dropRejectedLine('UNKNOWN_ITEM:p1')).toBe('小鸭')
    expect(checkout.getDraft().items).toHaveLength(0)
    expect(cart.getItems()).toHaveLength(1)
  })
  it('大白话：移完只剩搭配购——整个草稿清空（搭配购不能单买）', () => {
    checkout.prepareBuyNow({ id: 'p1', name: '小鸭', price: 128 })
    checkout.toggleAddon('hook')
    checkout.dropRejectedLine('UNLISTED_ITEM:p1')
    expect(checkout.getDraft().items).toHaveLength(0)
  })
})

describe('结算页：拒单后能继续下单', () => {
  async function mount(buyNow = false): Promise<Record<string, any>> {
    let opts: Record<string, any> = {}
    ;(globalThis as any).Page = (o: Record<string, any>) => (opts = o)
    vi.resetModules()
    const ck = await import('../lib/checkout')
    const ct = await import('../lib/cart')
    ;(await import('../lib/address')).saveAddress({ name: 'a', phone: '13800000000', region: 'r', detail: 'd', isDefault: true })
    if (buyNow) ck.prepareBuyNow({ id: 'p1', name: '小鸭', price: 128 })
    else {
      ct.add({ id: 'p1', name: '小鸭', price: 128 })
      ct.add({ id: 'p2', name: '云朵鸭', price: 22 })
      ck.prepareFromCart()
    }
    await import('../pages/checkout/checkout')
    const page = Object.create(opts) as Record<string, any>
    page.data = { ...opts.data }
    page.setData = function (patch: Record<string, unknown>) {
      Object.assign(this.data as Record<string, unknown>, patch)
    }
    page.onReady()
    await page.refresh()
    return page
  }
  it('大白话：立即购买的唯一一件下架了——弹窗不说「其余商品可以继续下单」，点知道了就退回，不再叠「没有要结算的商品」提示', async () => {
    vi.useFakeTimers()
    try {
      const page = await mount(true)
      createOrderMock.mockResolvedValueOnce({ ok: false, error: 'UNLISTED_ITEM:p1' })
      await page.onSubmit()
      await vi.runAllTimersAsync()
      expect(wxMock.showModal).toHaveBeenCalledTimes(1)
      const modal = wxMock.showModal.mock.calls[0][0]
      expect(modal.content).toContain('小鸭')
      expect(modal.content).not.toContain('其余商品')
      expect(wxMock.showToast).not.toHaveBeenCalled()
      expect(wxMock.navigateBack).not.toHaveBeenCalled() // 用户还没看完弹窗
      modal.success({ confirm: true })
      expect(wxMock.navigateBack).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
  it('大白话：p2 下架被拒——弹窗点名「云朵鸭」，再点提交只带 p1，页面没锁死', async () => {
    const page = await mount()
    createOrderMock.mockResolvedValueOnce({ ok: false, error: 'UNLISTED_ITEM:p2' })
    await page.onSubmit()
    expect(wxMock.showModal).toHaveBeenCalledTimes(1)
    expect(wxMock.showModal.mock.calls[0][0].content).toContain('云朵鸭')
    expect(page.data.submitting).toBe(false)
    createOrderMock.mockResolvedValueOnce({ ok: false, error: 'TOO_MANY_PENDING' })
    await page.onSubmit()
    expect(createOrderMock.mock.calls[1][0].map((l: { id: string }) => l.id)).toEqual(['p1'])
    expect(wxMock.showToast.mock.calls.at(-1)[0].title).toContain('我的订单')
  })
})

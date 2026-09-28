// UX 修复：购物车本地存的是加购时的价，结算「应付」照旧价显示、云端却按现价扣——
// 购物车/结算页拿到最新商品档后按现价覆盖（规格行按规格价，与云端 createOrder priceItems 同口径）。
// 商品不在货架（停售/删档）或规格没了：那行原样留着，交给下单时云端拒单 + dropRejectedLine 点名移出（不静默丢）。
import { describe, it, expect, beforeEach } from 'vitest'
import * as cart from '../lib/cart'
import * as checkout from '../lib/checkout'

let storage: Record<string, unknown> = {}
;(globalThis as any).wx = {
  getStorageSync: (k: string) => storage[k],
  setStorageSync: (k: string, v: unknown) => {
    storage[k] = JSON.parse(JSON.stringify(v))
  },
}

const DUCK = { id: 'p1', name: '小鸭', price: 128 }
const ALL = [
  { id: 'p1', name: '小鸭', price: 99, skus: [{ name: '云朵白', price: 109 }] },
  { _id: 'p2', name: '鹅', price: 20 },
]

beforeEach(() => {
  storage = {}
  cart.__resetForTest()
  checkout.__resetForTest()
})

describe('购物车按最新价同步', () => {
  it('大白话：加购时 128 元、现在 99——同步后车里按 99 算、写回本地、返回「有变动」；规格行按规格现价；再同步不再报变动', () => {
    cart.add(DUCK)
    cart.add({ ...DUCK, sku: '云朵白', price: 138 })
    cart.add({ id: 'p2', name: '鹅', price: 20 })
    expect(cart.syncPrices(ALL)).toBe(true)
    expect(cart.getItems().map((i) => [i.id, i.sku, i.price])).toEqual([
      ['p1', '', 99],
      ['p1', '云朵白', 109],
      ['p2', '', 20],
    ])
    expect(cart.selectedTotalLabel()).toBe('¥228.00')
    cart.__resetForTest() // 冷启动回灌：本地存的已是新价
    expect(cart.getItems()[0].price).toBe(99)
    expect(cart.syncPrices(ALL)).toBe(false)
  })

  it('大白话：商品不在货架、规格没了、价格是脏值——那行原样留着，不静默丢', () => {
    cart.add({ id: 'gone', name: '下架鸭', price: 50 })
    cart.add({ ...DUCK, sku: '已停款', price: 138 })
    cart.add({ id: 'p3', name: '脏价', price: 10 })
    expect(cart.syncPrices([...ALL, { id: 'p3', name: '脏价', price: 'x' }])).toBe(false)
    expect(cart.getItems().map((i) => [i.id, i.price])).toEqual([
      ['gone', 50],
      ['p1', 138],
      ['p3', 10],
    ])
  })
})

describe('结算草稿按最新价同步', () => {
  it('大白话：草稿里是旧价——同步后应付按现价重算并返回「有变动」；找不到的商品不动', () => {
    cart.add(DUCK)
    cart.add({ ...DUCK, sku: '云朵白', price: 138 })
    cart.add({ id: 'gone', name: '下架鸭', price: 50 })
    checkout.prepareFromCart()
    expect(checkout.syncDraftPrices(ALL)).toBe(true)
    expect(checkout.getDraft().items.map((l) => [l.id, l.sku, l.price])).toEqual([
      ['p1', '', 99],
      ['p1', '云朵白', 109],
      ['gone', '', 50],
    ])
    expect(checkout.summaryFen().goodsFen).toBe(9900 + 10900 + 5000)
    expect(checkout.syncDraftPrices(ALL)).toBe(false)
  })

  it('大白话：立即购买的草稿同样按现价', () => {
    checkout.prepareBuyNow({ ...DUCK, sku: '云朵白', price: 138 })
    expect(checkout.syncDraftPrices(ALL)).toBe(true)
    expect(checkout.summaryFen().goodsFen).toBe(10900)
  })
})

describe('拒单码人话', () => {
  it('大白话：后台把价格配坏了（BAD_SKU_PRICE / BAD_PRICE）——不落「下单没成功，稍后再试」；「待付款」统一说「待支付」', () => {
    expect(checkout.mapCreateOrderError('BAD_SKU_PRICE:p1:云朵白')).not.toBe('下单没成功，稍后再试')
    expect(checkout.mapCreateOrderError('BAD_PRICE:p1')).not.toBe('下单没成功，稍后再试')
    expect(checkout.mapCreateOrderError('TOO_MANY_PENDING')).toContain('待支付')
    expect(checkout.mapCreateOrderError('TOO_MANY_PENDING')).not.toContain('待付款')
  })
})

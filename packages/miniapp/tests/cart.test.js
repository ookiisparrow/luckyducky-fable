import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useCartStore, sanitizeCart } from '@/store/cart.js'

// 不挂 persist 插件，纯测 store 逻辑
beforeEach(() => setActivePinia(createPinia()))

describe('cart store', () => {
  it('add：新商品入车；再 add 同 id 数量 +1', () => {
    const cart = useCartStore()
    cart.add({ id: 'p1', name: 'A', price: 10, was: 20 })
    expect(cart.items.length).toBe(1)
    expect(cart.items[0].qty).toBe(1)
    cart.add({ id: 'p1', name: 'A', price: 10 })
    expect(cart.items.length).toBe(1)
    expect(cart.items[0].qty).toBe(2)
  })

  it('selectedCount / selectedTotal 只算选中项', () => {
    const cart = useCartStore()
    cart.add({ id: 'p1', name: 'A', price: 10 })
    cart.add({ id: 'p2', name: 'B', price: 5 })
    cart.items[1].selected = false
    expect(cart.selectedCount).toBe(1)
    expect(cart.selectedTotal).toBe(10)
  })

  it('finishCheckout：按提交数量精确扣减（改量后不误删整条）', () => {
    const cart = useCartStore()
    cart.add({ id: 'p1', name: 'A', price: 10 })
    cart.setQty('p1', 3)
    cart.prepareCheckoutFromCart()
    cart.finishCheckout([{ id: 'p1', qty: 1 }]) // 只提交 1 件
    expect(cart.items[0].qty).toBe(2) // 还剩 2
  })

  it('finishCheckout：提交全部数量则移除该条', () => {
    const cart = useCartStore()
    cart.add({ id: 'p1', name: 'A', price: 10 })
    cart.setQty('p1', 2)
    cart.prepareCheckoutFromCart()
    cart.finishCheckout([{ id: 'p1', qty: 2 }])
    expect(cart.items.length).toBe(0)
  })

  it('finishCheckout：带 SKU 条目全量结算后应移除，同 id 其他 SKU 不受影响（审核批次B）', () => {
    const cart = useCartStore()
    cart.add({ id: 'p9', name: 'X', price: 198, sku: '经典暖黄' })
    cart.add({ id: 'p9', name: 'X', price: 208, sku: '雾霭蓝' })
    cart.prepareCheckoutFromCart()
    cart.finishCheckout([{ id: 'p9', qty: 1, sku: '经典暖黄' }])
    expect(cart.items.length).toBe(1) // 不残留 qty<=0 的暖黄条目
    expect(cart.items[0].sku).toBe('雾霭蓝') // 另一规格不被误删
  })
})

describe('SKU 条目（同 id 不同规格 = 独立条目）', () => {
  it('同 id 不同 sku 各成一条；同 id 同 sku 合并 +1', () => {
    const cart = useCartStore()
    cart.add({ id: 'p9', name: 'X', price: 198, sku: '经典暖黄' })
    cart.add({ id: 'p9', name: 'X', price: 208, sku: '雾霭蓝' })
    cart.add({ id: 'p9', name: 'X', price: 198, sku: '经典暖黄' })
    expect(cart.items.length).toBe(2)
    expect(cart.items.find((i) => i.sku === '经典暖黄').qty).toBe(2)
  })

  it('setQty / remove 按 id+sku 定位，不串台', () => {
    const cart = useCartStore()
    cart.add({ id: 'p9', name: 'X', price: 198, sku: 'A' })
    cart.add({ id: 'p9', name: 'X', price: 208, sku: 'B' })
    cart.setQty('p9', 5, 'A')
    expect(cart.items.find((i) => i.sku === 'A').qty).toBe(5)
    expect(cart.items.find((i) => i.sku === 'B').qty).toBe(1)
    cart.remove('p9', 'A')
    expect(cart.items.length).toBe(1)
    expect(cart.items[0].sku).toBe('B')
  })

  it('回灌契约：sku 缺失归一为空串', () => {
    const { items } = sanitizeCart({ items: [{ id: 'p1', name: 'A', price: 10, qty: 1 }] })
    expect(items[0].sku).toBe('')
  })
})

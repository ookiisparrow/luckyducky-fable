import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useCartStore } from '@/store/cart.js'

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
})

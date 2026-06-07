import { describe, it, expect, beforeEach } from 'vitest'
import { persistPlugin } from '@/store/persist.js'
import { sanitizeCart } from '@/store/cart.js'

// 造一个最小假 store（只测回灌，不测订阅落盘）
function makeStore(id, state) {
  return {
    $id: id,
    state,
    $patch(data) {
      Object.assign(this.state, data)
    },
    $subscribe() {},
  }
}

beforeEach(() => globalThis.__mem.clear())

describe('persistPlugin 回灌', () => {
  // 锁定脏数据 bug：用真实 sanitizeCart，残缺条目（含无 qty / qty 非正）回灌时被清掉，
  // 且有效条目的 qty 取整、selected 归一为布尔。
  it('sanitize 清洗：丢弃残缺条目（含无 qty）+ 归一化', () => {
    globalThis.__mem.set(
      'ld_store_cart',
      JSON.stringify({
        items: [
          { id: 'a', name: 'x', price: 1, qty: 2, selected: 1 }, // 有效（selected 待归一化）
          { id: 'b', name: 'y', price: 1 }, // 无 qty → 丢
          { id: 'c', name: 'z', price: 1, qty: 0 }, // qty 非正 → 丢
          { id: 'd', name: 'q', price: 1, qty: 0.5 }, // 小数 qty → 丢（审核 v0.1 #1）
          { id: null, name: 'w', price: 1, qty: 1 }, // 无 id → 丢
          {}, // 空 → 丢
        ],
      }),
    )
    const store = makeStore('cart', { items: [] })
    persistPlugin({ store, options: { persist: { paths: ['items'], sanitize: sanitizeCart } } })
    expect(store.state.items).toEqual([{ id: 'a', name: 'x', price: 1, qty: 2, selected: true }])
  })

  it('坏 JSON 不崩、退回初始 state', () => {
    globalThis.__mem.set('ld_store_x', '{坏的json')
    const store = makeStore('x', { a: 1 })
    expect(() => persistPlugin({ store, options: { persist: true } })).not.toThrow()
    expect(store.state.a).toBe(1)
  })

  it('无存档时不动 state', () => {
    const store = makeStore('y', { a: 1 })
    persistPlugin({ store, options: { persist: true } })
    expect(store.state.a).toBe(1)
  })
})

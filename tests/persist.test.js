import { describe, it, expect, beforeEach } from 'vitest'
import { persistPlugin } from '@/store/persist.js'

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
  // 锁定本次脏数据 bug：残缺条目在回灌时被 sanitize 清掉，不会进 state
  it('sanitize 清洗：丢弃残缺条目', () => {
    globalThis.__mem.set(
      'ld_store_cart',
      JSON.stringify({ items: [{ id: 'a', name: 'x', price: 1 }, { id: null }, {}] }),
    )
    const store = makeStore('cart', { items: [] })
    persistPlugin({
      store,
      options: {
        persist: {
          paths: ['items'],
          sanitize: (s) => ({
            items: (Array.isArray(s.items) ? s.items : []).filter(
              (it) => it && it.id != null && typeof it.price === 'number' && it.name,
            ),
          }),
        },
      },
    })
    expect(store.state.items).toEqual([{ id: 'a', name: 'x', price: 1 }])
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

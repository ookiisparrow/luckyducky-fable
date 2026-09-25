// 本地存储读写抛错时各 lib 的回落值：读抛 → 各自的「未知/空」默认；写抛 → 静默不崩。
// 钉住 address/cart/consent/loginGate/snapshot 共用 utils/storage 之后行为不变。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as address from '../lib/address'
import * as cart from '../lib/cart'
import { readConsentHint, writeConsentHint } from '../lib/consent'
import { createLoginGate } from '../lib/loginGate'
import { readSnapshot } from '../lib/snapshot'

const boom = () => {
  throw new Error('storage broken')
}

beforeEach(() => {
  ;(globalThis as any).wx = { getStorageSync: boom, setStorageSync: boom }
  address.__resetForTest()
  cart.__resetForTest()
})
afterEach(() => {
  delete (globalThis as any).wx
})

describe('storage 抛错回落', () => {
  it('大白话：读抛错 → 地址簿空、购物车空、授权提示未知、未同意登录、无首屏快照', () => {
    expect(address.getList()).toEqual([])
    expect(address.defaultAddress()).toBeNull()
    expect(cart.getItems()).toEqual([])
    expect(readConsentHint()).toBeNull()
    expect(createLoginGate().hasAgreed()).toBe(false)
    expect(readSnapshot()).toBeNull()
  })

  it('大白话：写抛错 → 不崩，内存态照常生效', () => {
    expect(() => address.saveAddress({ name: '鸭', phone: '13800000000', region: '浙江', detail: '1号' })).not.toThrow()
    expect(address.getList()).toHaveLength(1)
    expect(() => cart.add({ id: 'p1', name: '鸭', price: 10 })).not.toThrow()
    expect(cart.getItems()).toHaveLength(1)
    expect(() => writeConsentHint(true)).not.toThrow()
    const gate = createLoginGate()
    expect(() => gate.markAgreed()).not.toThrow()
    expect(() => gate.logout()).not.toThrow()
  })

  it('大白话：读到的值原样交给各自的清洗（读写走的是同一个键）', () => {
    const store: Record<string, unknown> = {}
    ;(globalThis as any).wx = {
      getStorageSync: (k: string) => store[k],
      setStorageSync: (k: string, v: unknown) => {
        store[k] = v
      },
    }
    writeConsentHint(false)
    expect(readConsentHint()).toBe(false)
    const gate = createLoginGate()
    gate.markAgreed()
    expect(gate.hasAgreed()).toBe(true)
    address.saveAddress({ name: '鸭', phone: '13800000000', region: '浙江', detail: '1号' })
    address.__resetForTest()
    expect(address.getList()).toHaveLength(1)
  })
})

// 首页冷启动首屏快照（rewrite/mp·丝滑战役批2·根因#15/#8）：roundtrip / 版本弃档 / 脏形状弃档 /
// 超龄剥临时址（保 /static）/ 白名单裁剪（images 等长字段不落）/ write 异常静默。
// wx.storage 以内存桩替代（同 cart.test.ts 家风·不 mock 模块）。
import { describe, it, expect, beforeEach } from 'vitest'
import { readSnapshot, writeSnapshot, __resetForTest, type HomeSnapshot } from '../lib/snapshot'

const KEY = 'ld:home-snap' // 与 lib/snapshot 内部键一致（超龄档需直接种入 storage 才好控 savedAt）
let storage: Record<string, unknown> = {}
let throwOnSet = false
;(globalThis as any).wx = {
  getStorageSync: (k: string) => storage[k],
  setStorageSync: (k: string, v: unknown) => {
    if (throwOnSet) throw new Error('storage quota exceeded')
    storage[k] = JSON.parse(JSON.stringify(v)) // 序列化桩·同真机 storage 只存可序列化值
  },
  removeStorageSync: (k: string) => {
    delete storage[k]
  },
}

// 原始商品（含列表用不到的长字段 images/description·验白名单裁剪）
const RAW_PRODUCTS = [
  { _id: 'p1', name: '小鸭', tag: '热卖', price: 128, was: 158, cover: 'https://cdn/x/p1.jpg', images: ['a', 'b', 'c'], description: '很长很长的详情文案'.repeat(50) },
  { id: 'p2', name: '云朵鸭', price: 138, cover: '/static/fallback.png' },
]
const RAW_HOME = {
  hero: { title: '创造幸运', img: 'https://cdn/x/hero.jpg' },
  feature: { title: '特写', img: 'https://cdn/x/feature.jpg' },
  reviews: { items: [{ quote: '好', user: '小满', img: 'https://cdn/x/rv1.jpg' }] },
}

beforeEach(() => {
  storage = {}
  throwOnSet = false
  __resetForTest()
})

describe('写读 roundtrip + 白名单裁剪', () => {
  it('大白话：写入后读回——products 只留白名单六字段（images/description 等长字段不落），home 原样', () => {
    writeSnapshot(RAW_PRODUCTS, RAW_HOME)
    const snap = readSnapshot()
    expect(snap).not.toBeNull()
    const s = snap as HomeSnapshot
    expect(s.v).toBe(1)
    expect(s.products).toHaveLength(2)
    // 白名单裁剪：只有六字段·images/description 不进快照
    expect(Object.keys(s.products[0]).sort()).toEqual(['cover', 'id', 'name', 'price', 'tag', 'was'])
    expect((s.products[0] as any).images).toBeUndefined()
    expect((s.products[0] as any).description).toBeUndefined()
    // id 双键：_id 归一到 id
    expect(s.products[0].id).toBe('p1')
    expect(s.products[1].id).toBe('p2')
    // 未超龄：http 临时址原样保留
    expect(s.products[0].cover).toBe('https://cdn/x/p1.jpg')
    expect((s.home as any).hero.img).toBe('https://cdn/x/hero.jpg')
  })

  it('大白话：products 为 null 只写 home 半边——保留上次的 products 不清空', () => {
    writeSnapshot(RAW_PRODUCTS, RAW_HOME) // 先存一份完整的
    writeSnapshot(null, { hero: { title: '换了文案' } }) // 本趟只拿到 home、products 失败
    const s = readSnapshot() as HomeSnapshot
    expect(s.products).toHaveLength(2) // products 半边被保留
    expect((s.home as any).hero.title).toBe('换了文案') // home 半边被更新
  })
})

describe('弃档（sanitize）', () => {
  it('大白话：版本号不符 → 弃档返 null（结构升级后旧档不复用）', () => {
    storage[KEY] = { v: 999, savedAt: Date.now(), products: [], home: {} }
    expect(readSnapshot()).toBeNull()
  })

  it('大白话：products 非数组 → 弃档', () => {
    storage[KEY] = { v: 1, savedAt: Date.now(), products: { bad: 1 }, home: {} }
    expect(readSnapshot()).toBeNull()
  })

  it('大白话：savedAt 非有限数（NaN/缺失/字符串）→ 弃档', () => {
    storage[KEY] = { v: 1, savedAt: 'yesterday', products: [], home: {} }
    expect(readSnapshot()).toBeNull()
    storage[KEY] = { v: 1, products: [], home: {} } // savedAt 缺失
    expect(readSnapshot()).toBeNull()
  })

  it('大白话：无档 → null', () => {
    expect(readSnapshot()).toBeNull()
  })
})

describe('超龄剥临时址', () => {
  it('大白话：超 90min 的档——products[].cover 与 home 内 http 临时址剥空，本地 /static 路径保留', () => {
    // 直接种一份「91 分钟前」的档（写路径 savedAt 恒 now·超龄场景须手种）
    const old = Date.now() - 91 * 60 * 1000
    storage[KEY] = {
      v: 1,
      savedAt: old,
      products: [
        { id: 'p1', name: '小鸭', tag: '', price: 128, was: 0, cover: 'https://cdn/x/p1.jpg' }, // http 临时址→剥空
        { id: 'p2', name: '云朵鸭', tag: '', price: 138, was: 0, cover: '/static/fallback.png' }, // 本地路径→保留
      ],
      home: { hero: { title: '创造幸运', img: 'https://cdn/x/hero.jpg' }, feature: { img: '/static/local.jpg' } },
    }
    const s = readSnapshot() as HomeSnapshot
    expect(s.products[0].cover).toBe('') // 超龄 http 址剥空
    expect(s.products[1].cover).toBe('/static/fallback.png') // 本地路径保留
    expect((s.home as any).hero.img).toBe('') // home 内 http 址剥空
    expect((s.home as any).hero.title).toBe('创造幸运') // 非图片文本原样
    expect((s.home as any).feature.img).toBe('/static/local.jpg') // 本地路径保留
  })

  it('大白话：未超龄的档——http 临时址原样不剥', () => {
    storage[KEY] = {
      v: 1,
      savedAt: Date.now() - 60 * 1000, // 1 分钟前·没超龄
      products: [{ id: 'p1', name: '小鸭', tag: '', price: 128, was: 0, cover: 'https://cdn/x/p1.jpg' }],
      home: { hero: { img: 'https://cdn/x/hero.jpg' } },
    }
    const s = readSnapshot() as HomeSnapshot
    expect(s.products[0].cover).toBe('https://cdn/x/p1.jpg')
    expect((s.home as any).hero.img).toBe('https://cdn/x/hero.jpg')
  })
})

describe('写入异常静默（纪律③·加分项失败不炸主渲染）', () => {
  it('大白话：setStorageSync 抛（storage 超限）→ writeSnapshot 吞掉不抛，也不落档', () => {
    throwOnSet = true
    expect(() => writeSnapshot(RAW_PRODUCTS, RAW_HOME)).not.toThrow()
    throwOnSet = false
    expect(readSnapshot()).toBeNull() // 没写进去
  })
})

// 目录会话缓存（rewrite/mp·病根#15·加载提速批A）：命中零云调用/miss 拉取回填/force 强刷/
// 失败不毁缓存。wx.cloud.callFunction 以内存桩替代（同 cart.test.ts 家风·不 mock 模块）。
import { describe, it, expect, beforeEach } from 'vitest'
import { getAllProducts, getProductById, getProductDetail, __resetForTest } from '../lib/catalog'

let calls = 0
let mode: 'ok' | 'fail' = 'ok'
let list: Record<string, unknown>[] = [{ id: 'p1', name: '小鸭', price: 128 }]
let product: Record<string, unknown> | null = { id: 'p1', name: '小鸭', cover: 'c', images: ['a', 'b'] }

;(globalThis as any).wx = {
  cloud: {
    callFunction: (opts: { data?: { action?: string }; success: (r: { result: unknown }) => void; fail: () => void }) => {
      calls++
      if (mode === 'fail') {
        opts.fail()
        return
      }
      // getProductDetail 回 { ok, product }；其余（getProducts）回 { ok, list }（同旧线家风·按 action 分流）
      if (opts.data?.action === 'getProductDetail') {
        opts.success({ result: { ok: true, product } })
        return
      }
      opts.success({ result: { ok: true, list } })
    },
  },
}

beforeEach(() => {
  calls = 0
  mode = 'ok'
  list = [{ id: 'p1', name: '小鸭', price: 128 }]
  product = { id: 'p1', name: '小鸭', cover: 'c', images: ['a', 'b'] }
  __resetForTest()
})

describe('getAllProducts（目录会话缓存）', () => {
  it('大白话：缓存空时拉一次并回填；随后不 force 再取直接命中缓存，零云调用', async () => {
    const first = await getAllProducts()
    expect(calls).toBe(1)
    expect(first).toEqual(list)
    const second = await getAllProducts()
    expect(calls).toBe(1) // 命中不再调 api
    expect(second).toBe(first) // 同一份缓存引用
  })

  it('大白话：force 无视已有缓存强刷一次，拿到最新数据并回填', async () => {
    await getAllProducts() // 先热一次
    expect(calls).toBe(1)
    list = [{ id: 'p2', name: '云朵鸭', price: 138 }] // 服务端数据变了
    const refreshed = await getAllProducts({ force: true })
    expect(calls).toBe(2)
    expect(refreshed).toEqual(list)
    // 强刷后再不带 force 取，命中的是新缓存
    const again = await getAllProducts()
    expect(calls).toBe(2)
    expect(again).toEqual(list)
  })

  it('大白话：失败返回 null 且不覆盖已有缓存——旧数据留着，下次非强刷仍能命中', async () => {
    const first = await getAllProducts() // 先热成功一次
    expect(first).toEqual(list)
    mode = 'fail'
    const failed = await getAllProducts({ force: true })
    expect(failed).toBeNull()
    mode = 'ok'
    const stillCached = await getAllProducts() // 不 force：读到的是没被抹掉的旧缓存
    expect(stillCached).toEqual(list)
    expect(calls).toBe(2) // 失败那次 + 本次命中不再调 api（仍是 2 次总调用，命中那次没新增）
  })

  it('大白话：缓存本就空时失败也返回 null（不是抛出、不是空数组）', async () => {
    mode = 'fail'
    const r = await getAllProducts()
    expect(r).toBeNull()
  })

  it('大白话：并发调用只发一次底层请求（在途去重·G4）——两次并发共享同一在途 promise 与结果', async () => {
    const [a, b] = await Promise.all([getAllProducts(), getAllProducts()])
    expect(calls).toBe(1)
    expect(a).toBe(b)
  })

  it('大白话：force 与非 force 并发撞车时后到调用复用同一在途 promise，不重复拉（G4·force 条款）', async () => {
    const [a, b] = await Promise.all([getAllProducts({ force: true }), getAllProducts()])
    expect(calls).toBe(1)
    expect(a).toBe(b)
  })
})

describe('getProductById（既有语义不变·内部改走 getAllProducts）', () => {
  it('大白话：空 id 直接 null 不发请求；命中按 id/_id 找到对应行；查无此 id 返 null', async () => {
    expect(await getProductById('')).toBeNull()
    expect(calls).toBe(0)
    const hit = await getProductById('p1')
    expect(hit).toEqual({ id: 'p1', name: '小鸭', price: 128 })
    expect(await getProductById('ghost')).toBeNull()
  })
})

describe('getProductDetail（单商品详情缓存·批1 列表瘦身配套·含 images 图册）', () => {
  it('大白话：首次拉一次回填、返回含 images 图册；命中缓存零云调用', async () => {
    const first = await getProductDetail('p1')
    expect(calls).toBe(1)
    expect(first).toEqual(product)
    const second = await getProductDetail('p1')
    expect(calls).toBe(1) // 命中缓存·不再调 api
    expect(second).toBe(first) // 同一份缓存引用
  })

  it('大白话：并发同 id 在途去重——复用同一 promise、只真取一次', async () => {
    const [a, b] = await Promise.all([getProductDetail('p1'), getProductDetail('p1')])
    expect(calls).toBe(1) // 两次并发只一次云调用
    expect(a).toBe(b)
  })

  it('大白话：失败返 null 且不缓存——下次可重试拿到', async () => {
    mode = 'fail'
    expect(await getProductDetail('p1')).toBeNull()
    mode = 'ok'
    const retried = await getProductDetail('p1') // 未缓存·重试
    expect(retried).toEqual(product)
    expect(calls).toBe(2) // 失败那次 + 重试那次
  })

  it('大白话：空 id 直接 null 不发请求', async () => {
    expect(await getProductDetail('')).toBeNull()
    expect(calls).toBe(0)
  })

  it('大白话：云端 product:null（未知 id/停售）→ null 且不缓存——下次仍进 api', async () => {
    product = null
    expect(await getProductDetail('ghost')).toBeNull()
    expect(calls).toBe(1)
    await getProductDetail('ghost')
    expect(calls).toBe(2) // null 不缓存
  })
})

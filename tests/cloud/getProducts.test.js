import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main } from '../../packages/cloud/src/functions/catalog/getProducts'

// getProducts（kit.getDb 试点 · catalog 域）：只读、无闸，按 sort 升序。
beforeEach(() => {
  control.reset()
  control.seed('products', [
    { _id: 'p2', id: 'p2', name: 'B', sort: 2 },
    { _id: 'p1', id: 'p1', name: 'A', sort: 1 },
  ])
})

describe('getProducts（catalog 域）', () => {
  it('返回商品列表，按 sort 升序', async () => {
    const res = await main()
    expect(res.ok).toBe(true)
    expect(res.list.map((p) => p._id)).toEqual(['p1', 'p2'])
  })
})

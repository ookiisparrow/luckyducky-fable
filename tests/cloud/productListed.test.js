import { describe, it, expect, beforeEach } from 'vitest'
import { createHash } from 'node:crypto'
import { control } from 'wx-server-sdk'
import { main as adminMain } from '../../packages/cloud/src/functions/admin/adminApi'
import { main as getProducts } from '../../packages/cloud/src/functions/catalog/getProducts'

// 商品停售/恢复（债#12·守卫 catalog-getproducts-listed-filter + product-unpublish-effective 的行为锁）：
// unpublishProduct 置 listed:false → getProducts 不再下发；republish 恢复；旧无 listed 字段视为可售（兼容）。
const KEY = 'listed-key-123'
const sha = (s) => createHash('sha256').update(String(s)).digest('hex')
const admin = (action, data = {}) =>
  adminMain({ httpMethod: 'POST', body: JSON.stringify({ action, key: KEY, data }) }).then((r) => ({
    status: r.statusCode,
    ...JSON.parse(r.body),
  }))

beforeEach(() => {
  control.reset()
  control.seed('adminConfig', [{ _id: 'auth', keyHash: sha(KEY) }])
  control.seed('products', [
    { _id: 'p1', id: 'p1', name: 'A', sort: 1 }, // 旧数据·无 listed 字段
    { _id: 'p2', id: 'p2', name: 'B', sort: 2, listed: true },
    { _id: 'p3', id: 'p3', name: 'C', sort: 3, listed: false }, // 已停售
  ])
})

describe('商品停售/恢复（债#12）', () => {
  it('getProducts 过滤已停售：下发 true 与旧无字段（兼容），不下发 listed:false', async () => {
    const res = await getProducts()
    expect(res.ok).toBe(true)
    expect(res.list.map((p) => p._id)).toEqual(['p1', 'p2']) // p3(listed:false) 被过滤
  })

  it('unpublishProduct 置 listed:false → getProducts 该品消失', async () => {
    expect((await admin('unpublishProduct', { id: 'p1' })).ok).toBe(true)
    expect(control.dump('products').find((p) => p._id === 'p1').listed).toBe(false)
    expect((await getProducts()).list.map((p) => p._id)).toEqual(['p2'])
  })

  it('republishProduct 恢复 → getProducts 重新下发', async () => {
    await admin('unpublishProduct', { id: 'p2' })
    expect((await getProducts()).list.map((p) => p._id)).toEqual(['p1'])
    expect((await admin('republishProduct', { id: 'p2' })).ok).toBe(true)
    expect((await getProducts()).list.map((p) => p._id)).toEqual(['p1', 'p2'])
  })

  it('停售/恢复不存在的商品 → NO_PRODUCT', async () => {
    expect((await admin('unpublishProduct', { id: 'nope' })).error).toBe('NO_PRODUCT')
    expect((await admin('republishProduct', { id: 'nope' })).error).toBe('NO_PRODUCT')
  })

  it('软下架非硬删：记录仍在（详情直达/历史订单不受影响），仅 listed 翻转', async () => {
    await admin('unpublishProduct', { id: 'p1' })
    const p = control.dump('products').find((x) => x._id === 'p1')
    expect(p).toBeTruthy()
    expect(p.name).toBe('A') // 商品数据完整保留
  })
})

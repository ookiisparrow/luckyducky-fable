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

// S11 控制台商品页：listDrafts 须附 listed 映射，控制台才能分「在售 / 已下架 / 筹备中」三态
// （在售=onsale+listed≠false·已下架=onsale+listed:false·筹备中=未上架无 products 文档）。
// 软下架（债#12）此前无管理端 UI，本映射是其在控制台显形的数据来源。
describe('listDrafts 附 listed 映射（S11·债#12 软下架显形）', () => {
  beforeEach(() => {
    // 草稿：p1/p2/p3 已上架（products 已 seed：p1 旧无字段 / p2 listed:true / p3 listed:false），p4 筹备中
    control.seed('productsDraft', [
      { _id: 'p1', id: 'p1', name: 'A', status: 'onsale', createdAt: 4 },
      { _id: 'p2', id: 'p2', name: 'B', status: 'onsale', createdAt: 3 },
      { _id: 'p3', id: 'p3', name: 'C', status: 'onsale', createdAt: 2 },
      { _id: 'p4', id: 'p4', name: 'D', status: 'preparing', createdAt: 1 },
    ])
  })

  it('listed 映射：旧无字段 true / listed:true true / listed:false false / 筹备中 undefined', async () => {
    const r = await admin('listDrafts')
    expect(r.ok).toBe(true)
    expect(r.listed.p1).toBe(true) // 旧无字段=可售（与 getProducts 同口径）
    expect(r.listed.p2).toBe(true)
    expect(r.listed.p3).toBe(false) // 已下架
    expect(r.listed.p4).toBeUndefined() // 筹备中无 products 文档
  })

  it('unpublishProduct 后 listDrafts 即反映 listed:false（已下架在控制台显形）', async () => {
    await admin('unpublishProduct', { id: 'p2' })
    const r = await admin('listDrafts')
    expect(r.listed.p2).toBe(false)
  })
})

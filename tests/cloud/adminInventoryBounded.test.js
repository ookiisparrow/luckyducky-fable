import { describe, it, expect, beforeEach } from 'vitest'
import cloud, { control } from 'wx-server-sdk'
import { listInventory } from '../../packages/cloud/src/functions/admin/adminApi/actions/inventory'

// 库存列表有界读（深审 P2·根因#7/#8）：真 SDK 裸 .get() 服务端默认 100 条静默截断（桩已对齐此语义）——
// SKU 破百后库存页少显示、像没库存记录。getInventory 改分页取齐（100/页·封顶 1000），到顶如实报 truncated。
// 守卫 inventory-reads-bounded 的行为侧。
const db = cloud.database()
const ctx = (data = {}) => ({ db, cloud, data, drafts: {} })
const parse = (res) => JSON.parse(res.body)
const seedN = (n) =>
  control.seed(
    'inventory',
    Array.from({ length: n }, (_, i) => ({
      _id: `p${String(i).padStart(4, '0')}__`,
      productId: `p${String(i).padStart(4, '0')}`,
      spec: '',
      stock: i,
    }))
  )

beforeEach(() => control.reset())

describe('listInventory 有界读（深审 P2·#7）', () => {
  it('SKU 超 100 条不静默截断：150 条全取回（分页取齐·真 SDK 默认 100 封顶下曾丢 50 条）', async () => {
    seedN(150)
    const r = parse(await listInventory(ctx({})))
    expect(r.ok).toBe(true)
    expect(r.list).toHaveLength(150) // 桩已对齐真 SDK 100 封顶——不分页此处只会拿到 100
    expect(r.truncated).toBe(false)
  })

  it('触扫描封顶（1000）→ 如实报 truncated（不装全量）', async () => {
    seedN(1000)
    const r = parse(await listInventory(ctx({})))
    expect(r.list).toHaveLength(1000)
    expect(r.truncated).toBe(true)
  })

  it('按 productIds 精确读路径不受影响；入参超长被封顶（防超长 in 查询）', async () => {
    seedN(5)
    const r = parse(await listInventory(ctx({ productIds: ['p0001', 'p0003'] })))
    expect(r.list.map((d) => d.productId).sort()).toEqual(['p0001', 'p0003'])
    expect(r.truncated).toBe(false)
    const long = parse(await listInventory(ctx({ productIds: Array.from({ length: 500 }, (_, i) => `p${i}`) })))
    expect(long.ok).toBe(true) // slice(0,200) 封顶·不炸
  })
})

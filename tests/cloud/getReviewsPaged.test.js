import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as getReviews } from '../../packages/cloud/src/functions/catalog/getReviews'

// 评价列表 cursor 分页 + bounded 汇总（债#13·根因#7·守卫 reviews-list-paged + reviews-paged-effective 行为锁）。
beforeEach(() => {
  control.reset()
  control.seed('reviews', [
    { _id: 'r1', productId: 'p1', name: 'A', rating: 5, tags: ['好'], text: 't1', createdAt: 300 },
    { _id: 'r2', productId: 'p1', name: 'B', rating: 4, tags: ['好', '快'], text: 't2', createdAt: 200 },
    { _id: 'r3', productId: 'p1', name: 'C', rating: 3, tags: [], text: 't3', createdAt: 100 },
    { _id: 'rx', productId: 'p2', name: 'X', rating: 1, tags: [], text: 'tx', createdAt: 50 },
  ])
})

describe('getReviews 列表分页 + 汇总（债#13·根因#7）', () => {
  it('无 productId → NO_PRODUCT', async () => {
    expect((await getReviews({})).error).toBe('NO_PRODUCT')
  })

  it('首页：limit 截断 + nextCursor + 汇总基于全样本（非当页）', async () => {
    const r = await getReviews({ productId: 'p1', limit: 2 })
    expect(r.ok).toBe(true)
    expect(r.list.map((x) => x.name)).toEqual(['A', 'B']) // createdAt desc
    expect(r.hasMore).toBe(true)
    expect(r.nextCursor).toBe(200) // 当页末条 createdAt
    expect(r.summary.count).toBe(3) // 汇总＝bounded 样本全量(p1=3)，不是分页的 2
    expect(r.summary.approx).toBe(false)
    expect(Number(r.summary.score)).toBeCloseTo((5 + 4 + 3) / 3, 1)
  })

  it('续页：带 cursor 接上、不重复返汇总', async () => {
    const r = await getReviews({ productId: 'p1', limit: 2, cursor: 200 })
    expect(r.list.map((x) => x.name)).toEqual(['C'])
    expect(r.hasMore).toBe(false)
    expect(r.nextCursor).toBe(null)
    expect(r.summary).toBeUndefined() // 续页不重算汇总（前端缓存首页汇总）
  })

  it('只取本商品评价（不串其它商品）', async () => {
    const r = await getReviews({ productId: 'p2' })
    expect(r.list.map((x) => x.name)).toEqual(['X'])
    expect(r.summary.count).toBe(1)
  })
})

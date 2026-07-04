// 黄金 kit-security §G：分页协议（游标式·limit 钳制·属主隔离）（守卫 rw-kit-golden）。
import { describe, it, expect, beforeEach } from 'vitest'
import fc from 'fast-check'
import { control } from 'wx-server-sdk'
import { getDb, pageParams, pageQuery } from '../src/kit'

beforeEach(() => {
  control.reset()
  control.seed(
    'orders',
    Array.from({ length: 25 }, (_, i) => ({ _id: 'o' + i, _openid: 'oME', createdAt: 1000 + i }))
  )
  control.seed('orders', [{ _id: 'other', _openid: 'oOTHER', createdAt: 5000 }])
})

describe('pageParams（limit 钳制·黄金 G）', () => {
  it('大白话：任意标量垃圾 limit（负/超大/小数/串/null/布尔/缺失）永远落在 [1,200]', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer({ min: -1e9, max: 1e9 }),
          fc.double(),
          fc.string(),
          fc.constant(null),
          fc.constant(undefined),
          fc.boolean()
        ),
        (v) => {
          const { limit } = pageParams({ limit: v as never })
          expect(limit).toBeGreaterThanOrEqual(1)
          expect(limit).toBeLessThanOrEqual(200)
        }
      )
    )
  })

  it('大白话：空游标（""/null/undefined）一律归一为 null，首页口径一致', () => {
    expect(pageParams({ cursor: '' }).cursor).toBe(null)
    expect(pageParams({ cursor: null }).cursor).toBe(null)
    expect(pageParams({}).cursor).toBe(null)
    expect(pageParams({ cursor: 123 }).cursor).toBe(123)
  })
})

describe('pageQuery（游标翻页·属主隔离·黄金 G）', () => {
  it('大白话：首页按排序键降序取 limit 条，多查一条判还有更多，下一页游标=本页末条排序值', async () => {
    const p = await pageQuery(getDb(), 'orders', { _openid: 'oME' }, 'createdAt', { limit: 10 })
    expect(p.list.length).toBe(10)
    expect(p.hasMore).toBe(true)
    expect(p.list[0].createdAt).toBe(1024)
    expect(p.nextCursor).toBe(p.list[9].createdAt)
  })

  it('大白话：拿游标续页只返回其后剩余记录、不重不漏，取空判无更多', async () => {
    const seen = new Set<string>()
    let cursor: unknown = undefined
    for (let round = 0; round < 5; round++) {
      const p = await pageQuery(getDb(), 'orders', { _openid: 'oME' }, 'createdAt', { limit: 10, cursor })
      for (const row of p.list) {
        expect(seen.has(row._id)).toBe(false)
        seen.add(row._id)
      }
      if (!p.hasMore) {
        expect(p.nextCursor).toBe(null)
        break
      }
      cursor = p.nextCursor
    }
    expect(seen.size).toBe(25)
  })

  it('大白话：查询按属主过滤——只返回本人记录、绝不含他人（无参兼容旧前端时亦然）', async () => {
    const p = await pageQuery(getDb(), 'orders', { _openid: 'oME' }, 'createdAt', undefined)
    expect(p.list.every((r: { _openid: string }) => r._openid === 'oME')).toBe(true)
    expect(p.list.some((r: { _id: string }) => r._id === 'other')).toBe(false)
  })
})

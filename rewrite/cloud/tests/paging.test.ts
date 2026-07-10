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
    // P2·根因#7 复合游标 tiebreaker 修复：nextCursor 从裸排序值改为 {v,id} 复合形状（打破同值平局）
    expect(p.nextCursor).toEqual({ v: p.list[9].createdAt, id: p.list[9]._id })
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

  it('大白话：复合游标 tiebreaker（P2·根因#7）——跨页边界同一 cursorField 值的多条记录不丢不重', async () => {
    control.reset()
    control.seed('orders', [
      { _id: 'tA', _openid: 'oME', createdAt: 1000 },
      { _id: 'tB', _openid: 'oME', createdAt: 1000 },
      { _id: 'tC', _openid: 'oME', createdAt: 1000 },
    ])
    const seen = new Set<string>()
    let cursor: unknown = undefined
    for (let round = 0; round < 5; round++) {
      const p = await pageQuery(getDb(), 'orders', { _openid: 'oME' }, 'createdAt', { limit: 1, cursor })
      for (const row of p.list) {
        expect(seen.has(row._id)).toBe(false) // 旧 bug（单一 lt(cursor)）：同值记录会被跳过或漏
        seen.add(row._id)
      }
      if (!p.hasMore) {
        expect(p.nextCursor).toBe(null)
        break
      }
      cursor = p.nextCursor
    }
    expect(seen.size).toBe(3) // 三条全部取到、不重
  })

  it('大白话：nextCursor 是复合形状 {v,id}；旧纯值游标（在途翻页会话）仍按旧语义可续页（向后兼容）', async () => {
    const p1 = await pageQuery(getDb(), 'orders', { _openid: 'oME' }, 'createdAt', { limit: 5 })
    expect(p1.nextCursor).toEqual({ v: (p1.nextCursor as any).v, id: (p1.nextCursor as any).id })
    expect(typeof (p1.nextCursor as any).v).toBe('number')

    // 模拟旧协议客户端：翻页会话里直接传裸值游标（不是 {v,id} 对象）
    const legacyCursor = 1015
    const p2 = await pageQuery(getDb(), 'orders', { _openid: 'oME' }, 'createdAt', { cursor: legacyCursor, limit: 5 })
    expect(p2.list.length).toBe(5)
    expect(p2.list.every((r: any) => r.createdAt < legacyCursor)).toBe(true)
  })
})

describe('pageQuery order 参数（Round8·根因#7 收口·order 可选 asc/desc·默认 desc 零漂移）', () => {
  it('大白话：不传 order 仍是既有 desc 行为（默认参数零漂移）', async () => {
    const p = await pageQuery(getDb(), 'orders', { _openid: 'oME' }, 'createdAt', { limit: 10 })
    expect(p.list[0].createdAt).toBe(1024)
    expect(p.list[9].createdAt).toBe(1015)
  })

  it('大白话：order=asc 首页按排序键升序取 limit 条，续页游标续取剩余、不丢不重', async () => {
    const p1 = await pageQuery(getDb(), 'orders', { _openid: 'oME' }, 'createdAt', { limit: 10 }, 20, 'asc')
    expect(p1.list.length).toBe(10)
    expect(p1.list[0].createdAt).toBe(1000)
    expect(p1.list[9].createdAt).toBe(1009)
    expect(p1.hasMore).toBe(true)
    expect(p1.nextCursor).toEqual({ v: p1.list[9].createdAt, id: p1.list[9]._id })

    const seen = new Set<string>()
    let cursor: unknown = undefined
    for (let round = 0; round < 5; round++) {
      const p = await pageQuery(getDb(), 'orders', { _openid: 'oME' }, 'createdAt', { limit: 10, cursor }, 20, 'asc')
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

  it('大白话：order=asc 复合游标 tiebreaker——同值撞分页边界不丢不重（镜像 desc 用例）', async () => {
    control.reset()
    control.seed('orders', [
      { _id: 'tA', _openid: 'oME', createdAt: 1000 },
      { _id: 'tB', _openid: 'oME', createdAt: 1000 },
      { _id: 'tC', _openid: 'oME', createdAt: 1000 },
    ])
    const seen = new Set<string>()
    let cursor: unknown = undefined
    for (let round = 0; round < 5; round++) {
      const p = await pageQuery(getDb(), 'orders', { _openid: 'oME' }, 'createdAt', { limit: 1, cursor }, 20, 'asc')
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
    expect(seen.size).toBe(3)
  })
})

import { describe, it, expect, beforeEach } from 'vitest'
import cloud, { control } from 'wx-server-sdk'
import { pageParams, pageQuery } from '../../../packages/cloud/src/kit'

// kit 分页（根因账本 #7）：游标式，多查一条判 hasMore，无参=首页。
beforeEach(() => control.reset())

describe('kit.pageParams', () => {
  it('无参=首页默认 limit；limit 钳 [1,200]、非法回默认；cursor 透传', () => {
    expect(pageParams(undefined, 50)).toEqual({ limit: 50, cursor: null })
    expect(pageParams({ limit: 999 }, 50).limit).toBe(200) // 钳上限
    expect(pageParams({ limit: 0 }, 50).limit).toBe(50) // 非法回默认
    expect(pageParams({ cursor: 100 }, 50).cursor).toBe(100)
    expect(pageParams({ cursor: '' }, 50).cursor).toBe(null) // 空串视同无游标
  })
})

describe('kit.pageQuery（游标分页）', () => {
  beforeEach(() => {
    control.seed('orders', [
      { _id: 'a', _openid: 'u1', createdAt: 100 },
      { _id: 'b', _openid: 'u1', createdAt: 200 },
      { _id: 'c', _openid: 'u1', createdAt: 300 },
      { _id: 'x', _openid: 'u2', createdAt: 250 }, // 他人，filter 排除
    ])
  })

  it('首页 limit=2：最新 2 条（desc）+ hasMore + nextCursor=末条排序值', async () => {
    const db = cloud.database()
    const p = await pageQuery(db, 'orders', { _openid: 'u1' }, 'createdAt', { limit: 2 })
    expect(p.list.map((o) => o._id)).toEqual(['c', 'b'])
    expect(p.hasMore).toBe(true)
    expect(p.nextCursor).toBe(200)
  })

  it('用 nextCursor 取下一页：剩余 1 条 + hasMore=false + nextCursor=null', async () => {
    const db = cloud.database()
    const p = await pageQuery(db, 'orders', { _openid: 'u1' }, 'createdAt', { limit: 2, cursor: 200 })
    expect(p.list.map((o) => o._id)).toEqual(['a']) // createdAt < 200
    expect(p.hasMore).toBe(false)
    expect(p.nextCursor).toBe(null)
  })

  it('无参（兼容旧前端）：默认 limit 返回全部本人、不含他人', async () => {
    const db = cloud.database()
    const p = await pageQuery(db, 'orders', { _openid: 'u1' }, 'createdAt', undefined, 100)
    expect(p.list.map((o) => o._id)).toEqual(['c', 'b', 'a'])
    expect(p.hasMore).toBe(false)
  })
})

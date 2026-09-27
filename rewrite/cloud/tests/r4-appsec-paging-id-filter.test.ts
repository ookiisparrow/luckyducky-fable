// #400-11：filter 里的 _id 条件和游标的 _id 界必须同时成立，游标不能把它覆盖掉。
// refund:manage 专员只能按精确单号查 listOrders；伪造一个游标就能翻出同一 createdAt 的别家订单，这就是越权。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { control } from 'wx-server-sdk'
import { COLLECTIONS } from '@ldrw/shared'
import { getDb, pageQuery } from '../src/kit'
import { main as adminApi } from '../src/functions/adminApi/index'
import { sha } from '../src/functions/adminApi/lib'

const ids = (rows: any[]) => rows.map((r) => r._id).sort()

beforeEach(() => {
  control.reset()
  control.setOpenId('')
  control.seed(COLLECTIONS.orders, [
    { _id: 'o-mine', _openid: 'oA', status: 'paid', createdAt: 1000, items: [] },
    { _id: 'o-other1', _openid: 'oB', status: 'paid', createdAt: 1000, items: [] },
    { _id: 'o-other2', _openid: 'oC', status: 'paid', createdAt: 900, items: [] },
  ])
})
afterEach(() => vi.restoreAllMocks())

describe('pageQuery：filter._id 与游标同时生效', () => {
  it('复合游标 tie 段：带 _id 过滤时只可能回这一单', async () => {
    const p = await pageQuery(getDb(), COLLECTIONS.orders, { _id: 'o-mine' }, 'createdAt', { cursor: { v: 1000, id: 'zzz' } })
    expect(ids(p.list)).toEqual(['o-mine'])
  })

  it('复合游标 tie 段：这一单不在游标之后就回空，不回别的单', async () => {
    const p = await pageQuery(getDb(), COLLECTIONS.orders, { _id: 'o-mine' }, 'createdAt', { cursor: { v: 1000, id: 'a' } })
    expect(p.list).toEqual([])
  })

  it('排序字段就是 _id：复合游标和旧纯值游标都不能覆盖 filter._id', async () => {
    const db = getDb()
    expect(ids((await pageQuery(db, COLLECTIONS.orders, { _id: 'o-mine' }, '_id', { cursor: { v: 'zzz', id: 'zzz' } })).list)).toEqual(['o-mine'])
    expect(ids((await pageQuery(db, COLLECTIONS.orders, { _id: 'o-mine' }, '_id', { cursor: 'zzz' })).list)).toEqual(['o-mine'])
    expect((await pageQuery(db, COLLECTIONS.orders, { _id: 'o-mine' }, '_id', { cursor: 'a' })).list).toEqual([])
  })

  it('没带 _id 过滤时游标翻页照旧（tie 段按 _id 续）', async () => {
    const p = await pageQuery(getDb(), COLLECTIONS.orders, {}, 'createdAt', { cursor: { v: 1000, id: 'o-other1' } })
    expect(ids(p.list)).toEqual(['o-mine', 'o-other2'])
  })
})

describe('listOrders：只持 refund:manage 的专员带伪造游标也翻不出别的单', () => {
  it('q=本单 + 游标 {v:同一 createdAt, id:极大} → 只回本单', async () => {
    control.seed(COLLECTIONS.adminConfig, [{ _id: 'auth', keyHash: sha('super-key'), role: 'superadmin' }, { _id: 'refmgr', keyHash: sha('refmgr-key'), caps: ['refund:manage'] }])
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const r: any = await adminApi({
      httpMethod: 'POST',
      headers: { 'x-forwarded-for': '1.1.1.1' },
      body: JSON.stringify({ action: 'listOrders', key: 'refmgr-key', data: { q: 'o-mine', cursor: { v: 1000, id: 'zzz' } } }),
    })
    const body = JSON.parse(r.body)
    expect(r.statusCode).toBe(200)
    expect(body.list.map((o: any) => o._id)).toEqual(['o-mine'])
  })
})

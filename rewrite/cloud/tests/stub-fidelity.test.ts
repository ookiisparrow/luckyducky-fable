// 内存桩自己的逼真度：桩比真云宽松时，依赖宽松行为的生产 bug 在测试里恒绿（#388）。
// 桩不模拟事务（全仓云函数不用事务，真要用时再补）。
import { describe, it, expect, beforeEach } from 'vitest'
import cloud, { control } from 'wx-server-sdk'

const db = cloud.database()
const docs = (n: number) => Array.from({ length: n }, (_, i) => ({ _id: 'd' + i, k: 1, g: 'g' + i, a: i, b: 'x' }))

beforeEach(() => control.reset())

describe('wx-server-sdk 内存桩对齐真云', () => {
  it('大白话：field() 投影只回投影字段和 _id', async () => {
    control.seed('t', docs(1))
    const r = await db.collection('t').field({ a: true }).get()
    expect(r.data).toEqual([{ _id: 'd0', a: 0 }])
  })

  it('大白话：聚合不写 limit 只回 20 条，写了 limit 按 limit', async () => {
    control.seed('t', docs(25))
    expect((await db.collection('t').aggregate().match({ k: 1 }).end()).list).toHaveLength(20)
    expect((await db.collection('t').aggregate().match({ k: 1 }).group({ _id: '$g' }).end()).list).toHaveLength(20)
    expect((await db.collection('t').aggregate().match({ k: 1 }).limit(25).end()).list).toHaveLength(25)
  })

  it('大白话：limit 超过 1000 报错，1000 本身可以', async () => {
    await expect(db.collection('t').limit(1001).get()).rejects.toThrow()
    await expect(db.collection('t').aggregate().match({}).limit(1001).end()).rejects.toThrow()
    await expect(db.collection('t').limit(1000).get()).resolves.toBeTruthy()
  })

  it('大白话：where().update()/remove() 作用于全部匹配文档，不被读取默认 100 条截断', async () => {
    control.seed('t', docs(150))
    expect((await db.collection('t').where({ k: 1 }).update({ data: { b: 'y' } })).stats.updated).toBe(150)
    expect(control.dump('t').every((d) => d.b === 'y')).toBe(true)
    expect((await db.collection('t').where({ k: 1 }).remove()).stats.removed).toBe(150)
  })

  it('大白话：集合未建时 where().update()/remove() 与 doc().update()/add() 一样报错', async () => {
    control.markUncreated('t')
    await expect(db.collection('t').where({ k: 1 }).update({ data: { b: 'y' } })).rejects.toThrow(/COLLECTION_NOT_EXIST/)
    await expect(db.collection('t').where({ k: 1 }).remove()).rejects.toThrow(/COLLECTION_NOT_EXIST/)
  })

  it('大白话：桩不认识的查询操作符报错，不静默当「不匹配」', async () => {
    control.seed('t', docs(1))
    await expect(db.collection('t').where({ a: db.command.inc(1) }).get()).rejects.toThrow()
  })

  it('大白话：serverDate 写进去读出来还是 Date，不变成字符串', async () => {
    await db.collection('t').add({ data: { _id: 'x', at: db.serverDate() } })
    const r = await db.collection('t').doc('x').get()
    expect(r.data.at).toBeInstanceOf(Date)
    // 真云只在同类型间比大小：Date 字段拿数字时间戳去比，一条都不匹配
    const _ = db.command
    expect((await db.collection('t').where({ at: _.lt(Date.now() + 1e3) }).get()).data).toHaveLength(0)
    expect((await db.collection('t').where({ at: _.gt(0) }).get()).data).toHaveLength(0)
  })
})

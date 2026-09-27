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

  // 以下三条对齐 wx-server-sdk 2.6.3 → @cloudbase/database 1.4.1 源码：where/update 都先 flatten（undefined 键删掉、
  // 嵌套普通对象拍成点路径），update 以 $set 逐叶写；stats.updated 是服务端回的改动条数
  it('大白话：where 里值为 undefined 的键等于没这个条件，不是「字段缺失」；全是 undefined 直接报错', async () => {
    control.seed('t', [
      { _id: 'has', k: 1, v: 5 },
      { _id: 'miss', k: 1 },
    ])
    const ids = async (q: object) => (await db.collection('t').where(q).get()).data.map((d: any) => d._id)
    expect(await ids({ k: 1, v: undefined })).toEqual(['has', 'miss'])
    expect((await db.collection('t').where({ k: 1, v: undefined }).update({ data: { b: 'y' } })).stats.updated).toBe(2)
    expect(() => db.collection('t').where({ v: undefined })).toThrow()
  })

  it('大白话：update 里的嵌套对象是合并不是整体替换；空对象不动原值；数组整体替换', async () => {
    control.seed('t', [{ _id: 'x', a: { p: 1, q: 2 }, e: { keep: 1 }, arr: [1, 2, 3] }])
    await db.collection('t').doc('x').update({ data: { a: { p: 9 }, e: {}, arr: [7] } })
    expect(control.dump('t')[0]).toEqual({ _id: 'x', a: { p: 9, q: 2 }, e: { keep: 1 }, arr: [7] })
  })

  it('大白话：内容没变 updated 回 0，只数真改动了的文档', async () => {
    control.seed('t', [
      { _id: 'a', k: 1, b: 'y', n: { m: 1 } },
      { _id: 'b', k: 1, b: 'x', n: { m: 1 } },
    ])
    expect((await db.collection('t').doc('a').update({ data: { b: 'y', n: { m: 1 } } })).stats.updated).toBe(0)
    expect((await db.collection('t').where({ k: 1 }).update({ data: { b: 'y' } })).stats.updated).toBe(1)
    expect((await db.collection('t').doc('a').update({ data: { n: { m: 2 } } })).stats.updated).toBe(1)
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

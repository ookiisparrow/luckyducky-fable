// transition 原语自身的竞态：读到 from 态之后、条件写落地之前被并发方改了状态，
// 条件写必须落空（moved:false）且一个字段都不写——下游钱链的「副作用绑首次流转」全靠这一点。
import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { transition } from '../src/kit'

// 并发方直接改库（绕过写钩子，免得递归触发自己）
const store = (coll: string): any[] => (globalThis as any).__cloudMock.store[coll]
const doc = (id: string) => control.dump('orders').find((o: any) => o._id === id)

beforeEach(() => {
  control.reset()
  control.seed('orders', [{ _id: 'a', status: 'pending', amount: 10 }])
})

describe('transition 竞态（条件写 CAS）', () => {
  it('大白话：读后被并发关单——条件写不命中，回 moved:false，不落 patch 也不改状态', async () => {
    let writes = 0
    control.setBeforeUpdate(async ({ coll }: any) => {
      writes++
      if (coll === 'orders') store('orders')[0].status = 'closed'
    })
    const r = await transition('orders', 'a', ['pending'], 'paid', { paidAt: 9 })
    expect(writes).toBe(1)
    expect(r.moved).toBe(false)
    expect(r.doc.status).toBe('pending') // 回的是流转前读到的快照
    expect(doc('a')).toEqual({ _id: 'a', status: 'closed', amount: 10 })
  })

  it('大白话：函数 patch 也一样——读后状态被推进，算出的字段一个都不写', async () => {
    control.setBeforeUpdate(async () => {
      store('orders')[0].status = 'paid'
    })
    const r = await transition('orders', 'a', ['pending'], 'closed', (d) => ({ closedAt: 1, was: d.status }))
    expect(r.moved).toBe(false)
    expect(doc('a')).toEqual({ _id: 'a', status: 'paid', amount: 10 })
  })

  it('大白话：两路并发抢同一条边——只有一路 moved:true，另一路落空', async () => {
    const [x, y] = await Promise.all([
      transition('orders', 'a', ['pending'], 'paid', { by: 'x' }),
      transition('orders', 'a', ['pending'], 'paid', { by: 'y' }),
    ])
    expect([x.moved, y.moved].filter(Boolean).length).toBe(1)
    expect(doc('a').by).toBe(x.moved ? 'x' : 'y')
  })
})

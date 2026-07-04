// 黄金 kit-security §A：状态机原子流转与幂等（守卫 rw-kit-golden）。
import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { transition } from '../src/kit'

beforeEach(() => {
  control.reset()
  control.seed('orders', [
    { _id: 'a', status: 'pending', amount: 10 },
    { _id: 'b', status: 'paid', amount: 20 },
  ])
})

describe('transition（条件状态流转·黄金 A）', () => {
  it('大白话：当前态 ∈ from → 翻到 to 并落 patch，回报已流转', async () => {
    const r = await transition('orders', 'a', ['pending', 'closed'], 'paid', { paidAt: 9 })
    expect(r.moved).toBe(true)
    const a = control.dump('orders').find((o) => o._id === 'a')
    expect(a.status).toBe('paid')
    expect(a.paidAt).toBe(9)
  })

  it('大白话：当前态 ∉ from → 原地不动回报未流转，绝不跳级不倒退', async () => {
    const r = await transition('orders', 'b', ['pending', 'closed'], 'paid', { paidAt: 9 })
    expect(r.moved).toBe(false)
    expect(control.dump('orders').find((o) => o._id === 'b').paidAt).toBeUndefined()
  })

  it('大白话：目标单据不存在 → 未流转，不新建', async () => {
    const r = await transition('orders', 'nope', ['pending'], 'paid')
    expect(r.moved).toBe(false)
    expect(control.dump('orders').length).toBe(2)
  })

  it('大白话：patch 允许是函数——回调拿到流转前快照，可据旧值算新值', async () => {
    const r = await transition('orders', 'a', ['pending'], 'paid', (doc) => ({ was: doc.status, twice: doc.amount * 2 }))
    expect(r.moved).toBe(true)
    const a = control.dump('orders').find((o) => o._id === 'a')
    expect(a.was).toBe('pending')
    expect(a.twice).toBe(20)
  })

  it('大白话：重复流转第二次是空操作，不覆盖第一次已写入的值（幂等）', async () => {
    await transition('orders', 'a', ['pending'], 'paid', { paidAt: 111 })
    const r2 = await transition('orders', 'a', ['pending'], 'paid', { paidAt: 999 })
    expect(r2.moved).toBe(false)
    expect(control.dump('orders').find((o) => o._id === 'a').paidAt).toBe(111)
  })
})

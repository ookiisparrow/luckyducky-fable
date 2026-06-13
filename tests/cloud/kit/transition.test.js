import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { transition } from '../../../packages/cloud/src/kit'

// kit.transition 反向测试（根因账本 #2）：把 from 改宽 / 去掉条件更新，对应用例变红。
beforeEach(() => {
  control.reset()
  control.seed('orders', [
    { _id: 'a', status: 'pending', amount: 10 },
    { _id: 'b', status: 'paid', amount: 20 },
  ])
})

describe('kit.transition（条件状态流转）', () => {
  it('当前态 ∈ from → 翻到 to，moved=true', async () => {
    const r = await transition('orders', 'a', ['pending', 'closed'], 'paid', { paidAt: 9 })
    expect(r.moved).toBe(true)
    const a = control.dump('orders').find((o) => o._id === 'a')
    expect(a.status).toBe('paid')
    expect(a.paidAt).toBe(9)
  })

  it('当前态 ∉ from → no-op，moved=false（不跳级/不倒退）', async () => {
    const r = await transition('orders', 'b', ['pending', 'closed'], 'paid', { paidAt: 9 })
    expect(r.moved).toBe(false)
    expect(control.dump('orders').find((o) => o._id === 'b').paidAt).toBeUndefined()
  })

  it('单据不存在 → moved=false，doc 缺', async () => {
    const r = await transition('orders', 'nope', ['pending'], 'paid')
    expect(r.moved).toBe(false)
    expect(r.doc).toBeUndefined()
  })

  it('patch 为函数 → 收到流转前 doc，可据旧值算 patch', async () => {
    let seenAmount
    await transition('orders', 'a', ['pending'], 'paid', (doc) => {
      seenAmount = doc.amount
      return { note: 'amt' + doc.amount }
    })
    expect(seenAmount).toBe(10)
    expect(control.dump('orders').find((o) => o._id === 'a').note).toBe('amt10')
  })

  it('重复流转：第二次 no-op（幂等自检）', async () => {
    await transition('orders', 'a', ['pending'], 'paid', { v: 1 })
    const r2 = await transition('orders', 'a', ['pending'], 'paid', { v: 2 })
    expect(r2.moved).toBe(false)
    expect(control.dump('orders').find((o) => o._id === 'a').v).toBe(1) // 第二次没覆盖
  })
})

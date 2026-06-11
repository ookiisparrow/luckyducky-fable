import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main } from '../../cloudfunctions/confirmEnter/index.js'

// confirmEnter 闸门：确认进课写 enteredAt（只写一次）+ 退货权启发失效（翻最早可退条目）。
beforeEach(() => {
  control.reset()
  control.setOpenId('user-A')
  control.seed('activations', [
    { _id: 'act1', _openid: 'user-A', courseId: 'course-duck', code: 'LDCODE1', enteredAt: null },
  ])
  control.seed('products', [{ _id: 'prod-1', id: 'prod-1', courseId: 'course-duck' }])
})

describe('confirmEnter 闸门', () => {
  it('NO_OPENID / NOT_ACTIVATED', async () => {
    control.setOpenId('')
    expect((await main({ code: 'LDCODE1' })).error).toBe('NO_OPENID')
    control.setOpenId('user-A')
    expect((await main({ code: 'OTHER' })).error).toBe('NOT_ACTIVATED')
  })

  it('enteredAt 只写一次：二次确认保留原值', async () => {
    const first = await main({ code: 'LDCODE1' })
    expect(first.enteredAt).toBeGreaterThan(0)
    const second = await main({ code: 'LDCODE1' })
    expect(second.enteredAt).toBe(first.enteredAt) // 幂等
  })

  it('退货权失效：本人 paid 订单里最早一条可退条目翻 false', async () => {
    control.seed('orders', [
      { _id: 'o1', id: 'o1', _openid: 'user-A', status: 'paid', createdAt: 100, items: [{ productId: 'prod-1', refundable: true }] },
    ])
    const res = await main({ code: 'LDCODE1' })
    expect(res.revoked).toMatchObject({ orderId: 'o1', productId: 'prod-1' })
    expect(control.dump('orders')[0].items[0].refundable).toBe(false)
  })

  it('送礼场景（确认者无订单）：revoked 为 null，不报错', async () => {
    const res = await main({ code: 'LDCODE1' })
    expect(res.ok).toBe(true)
    expect(res.revoked).toBeNull()
  })
})

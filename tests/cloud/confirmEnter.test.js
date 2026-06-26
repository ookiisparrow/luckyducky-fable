import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main } from '../../packages/cloud/src/functions/learning/confirmEnter'

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

  it('退货权失效覆盖 shipped/done 订单（bug H：真实流程收货后才确认）', async () => {
    control.seed('orders', [
      { _id: 'o1', id: 'o1', _openid: 'user-A', status: 'shipped', createdAt: 100, items: [{ productId: 'prod-1', refundable: true }] },
    ])
    const res = await main({ code: 'LDCODE1' })
    expect(res.revoked).toMatchObject({ orderId: 'o1', productId: 'prod-1' })
    expect(control.dump('orders')[0].items[0].refundable).toBe(false)
  })

  it('重复确认不多扣（bug I：失效块限定首次进课）：二次 confirmEnter 不翻第二笔', async () => {
    control.seed('orders', [
      { _id: 'o1', id: 'o1', _openid: 'user-A', status: 'paid', createdAt: 100, items: [{ productId: 'prod-1', refundable: true }] },
      { _id: 'o2', id: 'o2', _openid: 'user-A', status: 'paid', createdAt: 200, items: [{ productId: 'prod-1', refundable: true }] },
    ])
    const first = await main({ code: 'LDCODE1' })
    expect(first.revoked.orderId).toBe('o1') // 最早一笔
    const second = await main({ code: 'LDCODE1' }) // 重复确认
    expect(second.revoked).toBeNull() // 不再翻第二笔
    const orders = control.dump('orders')
    expect(orders.find((o) => o._id === 'o1').items[0].refundable).toBe(false)
    expect(orders.find((o) => o._id === 'o2').items[0].refundable).toBe(true) // o2 仍可退
  })

  it('送礼场景（确认者无订单）：revoked 为 null，不报错', async () => {
    const res = await main({ code: 'LDCODE1' })
    expect(res.ok).toBe(true)
    expect(res.revoked).toBeNull()
  })

  it('数量级进课：买3件进1件→enteredQty=1·仍可退（不整行作废·外审 P1.3）', async () => {
    control.seed('orders', [
      { _id: 'o1', id: 'o1', _openid: 'user-A', status: 'paid', createdAt: 100, items: [{ productId: 'prod-1', qty: 3, enteredQty: 0, refundable: true }] },
    ])
    const res = await main({ code: 'LDCODE1' })
    expect(res.revoked).toMatchObject({ orderId: 'o1', productId: 'prod-1' })
    const item = control.dump('orders')[0].items[0]
    expect(item.enteredQty).toBe(1)
    expect(item.refundable).toBe(true) // 剩 2 件仍可退（买 N 进 1 不再废全行）
  })

  it('数量级进课：买3进满3件→整行不可退（外审 P1.3）', async () => {
    control.seed('activations', [
      { _id: 'act2', _openid: 'user-A', courseId: 'course-duck', code: 'LDCODE2', enteredAt: null },
      { _id: 'act3', _openid: 'user-A', courseId: 'course-duck', code: 'LDCODE3', enteredAt: null },
    ])
    control.seed('orders', [
      { _id: 'o1', id: 'o1', _openid: 'user-A', status: 'paid', createdAt: 100, items: [{ productId: 'prod-1', qty: 3, enteredQty: 0, refundable: true }] },
    ])
    await main({ code: 'LDCODE1' })
    await main({ code: 'LDCODE2' })
    expect(control.dump('orders')[0].items[0]).toMatchObject({ enteredQty: 2, refundable: true }) // 剩1可退
    await main({ code: 'LDCODE3' })
    expect(control.dump('orders')[0].items[0]).toMatchObject({ enteredQty: 3, refundable: false }) // 全进·不可退
  })
})

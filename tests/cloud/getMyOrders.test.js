import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main } from '../../packages/cloud/src/functions/orders/getMyOrders'

// getMyOrders（kit.withOpenId 试点）：openid 闸，只见本人订单，按 createdAt 倒序。
beforeEach(() => {
  control.reset()
  control.setOpenId('user-A')
  control.seed('orders', [
    { _id: 'o1', _openid: 'user-A', status: 'paid', amount: 178, createdAt: 100 },
    { _id: 'o2', _openid: 'user-A', status: 'done', amount: 50, createdAt: 300 },
    { _id: 'o3', _openid: 'user-B', status: 'paid', amount: 99, createdAt: 200 },
  ])
})

describe('getMyOrders 闸门（kit withOpenId 试点）', () => {
  it('NO_OPENID：未登录拒（fail-closed）', async () => {
    control.setOpenId('')
    expect((await main({})).error).toBe('NO_OPENID')
  })

  it('只返回本人订单，按 createdAt 倒序', async () => {
    const res = await main({})
    expect(res.ok).toBe(true)
    expect(res.list.map((o) => o._id)).toEqual(['o2', 'o1']) // user-A only, desc
  })
})

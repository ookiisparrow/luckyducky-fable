import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main } from '../../packages/cloud/src/functions/orders/getOrderById'

// getOrderById（审核批次B 详情兜底）：openid 闸门，只能查本人订单。
beforeEach(() => {
  control.reset()
  control.setOpenId('user-A')
  control.seed('orders', [{ _id: 'o1', id: 'o1', _openid: 'user-A', status: 'paid', amount: 178 }])
})

describe('getOrderById 闸门', () => {
  it('NO_OPENID / NO_ID', async () => {
    control.setOpenId('')
    expect((await main({ id: 'o1' })).error).toBe('NO_OPENID')
    control.setOpenId('user-A')
    expect((await main({})).error).toBe('NO_ID')
  })

  it('本人订单可查；他人订单 NOT_FOUND（不泄露存在性）', async () => {
    const res = await main({ id: 'o1' })
    expect(res.ok).toBe(true)
    expect(res.order.amount).toBe(178)

    control.setOpenId('user-B')
    expect((await main({ id: 'o1' })).error).toBe('NOT_FOUND')
    expect((await main({ id: 'nope' })).error).toBe('NOT_FOUND')
  })
})

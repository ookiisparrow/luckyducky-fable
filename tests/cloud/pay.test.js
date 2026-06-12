import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main } from '../../cloudfunctions/pay/index.js'

// pay 闸门：openid + 本人订单 + 仅 pending + 金额取库内（不信任前端）+ 超时惰性关单 + PAY_MODE 放行。
beforeEach(() => {
  control.reset()
  control.setOpenId('user-A')
  control.seed('config', [{ _id: 'pay', mode: 'real', subMchId: '1900000000' }])
  control.seed('orders', [
    { _id: 'o1', id: 'o1', _openid: 'user-A', status: 'pending', amount: 178, createdAt: Date.now(), items: [{ name: '幸运小鸭礼盒' }] },
    { _id: 'o2', id: 'o2', _openid: 'user-A', status: 'paid', amount: 178, createdAt: Date.now(), items: [] },
    { _id: 'o3', id: 'o3', _openid: 'user-A', status: 'pending', amount: 178, createdAt: Date.now() - 16 * 60 * 1000, items: [] },
    { _id: 'o4', id: 'o4', _openid: 'user-A', status: 'pending', amount: 0, createdAt: Date.now(), items: [] },
  ])
})

describe('pay 闸门与发起支付', () => {
  it('NO_OPENID / NO_ID', async () => {
    control.setOpenId('')
    expect((await main({ id: 'o1' })).error).toBe('NO_OPENID')
    control.setOpenId('user-A')
    expect((await main({})).error).toBe('NO_ID')
  })

  it('NOT_FOUND：他人订单不能付', async () => {
    control.setOpenId('user-B')
    expect((await main({ id: 'o1' })).error).toBe('NOT_FOUND')
  })

  it('BAD_STATUS：已付订单不能再付', async () => {
    expect((await main({ id: 'o2' })).error).toBe('BAD_STATUS:paid')
  })

  it('PAY_NOT_ENABLED：mock 模式或缺商户号一律不放行', async () => {
    control.reset()
    control.setOpenId('user-A')
    control.seed('config', [{ _id: 'pay', mode: 'mock' }])
    control.seed('orders', [{ _id: 'o1', id: 'o1', _openid: 'user-A', status: 'pending', amount: 178, createdAt: Date.now(), items: [] }])
    expect((await main({ id: 'o1' })).error).toBe('PAY_NOT_ENABLED')

    control.reset()
    control.setOpenId('user-A')
    control.seed('config', [{ _id: 'pay', mode: 'real' }]) // 缺 subMchId
    control.seed('orders', [{ _id: 'o1', id: 'o1', _openid: 'user-A', status: 'pending', amount: 178, createdAt: Date.now(), items: [] }])
    expect((await main({ id: 'o1' })).error).toBe('PAY_NOT_ENABLED')
  })

  it('超时 pending 惰性关单：返回 ORDER_CLOSED 并落 closed', async () => {
    expect((await main({ id: 'o3' })).error).toBe('ORDER_CLOSED')
    const o3 = control.dump('orders').find((o) => o._id === 'o3')
    expect(o3.status).toBe('closed')
    expect(o3.closedAt).toBeGreaterThan(0)
  })

  it('成功发起：金额取库内 amount（分）、单号/商户号/回调名正确、回传 payment 参数', async () => {
    const res = await main({ id: 'o1' })
    expect(res.ok).toBe(true)
    expect(res.payment.package).toBe('prepay_id=mock')
    const calls = control.cloudPayCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0].totalFee).toBe(17800) // 库内 178 元 → 分；前端无从干预
    expect(calls[0].outTradeNo).toBe('o1')
    expect(calls[0].subMchId).toBe('1900000000')
    expect(calls[0].functionName).toBe('payCallback')
  })

  it('0 元单（券抵扣到 0）：不走微信，直接置 paid', async () => {
    const res = await main({ id: 'o4' })
    expect(res.ok).toBe(true)
    expect(res.paid).toBe(true)
    expect(control.cloudPayCalls()).toHaveLength(0)
    expect(control.dump('orders').find((o) => o._id === 'o4').status).toBe('paid')
  })

  it('UNIFIED_ORDER_FAIL：微信下单失败透传错误、订单留 pending', async () => {
    control.setCloudPayFail(true)
    expect((await main({ id: 'o1' })).error).toBe('UNIFIED_ORDER_FAIL')
    expect(control.dump('orders').find((o) => o._id === 'o1').status).toBe('pending')
  })
})

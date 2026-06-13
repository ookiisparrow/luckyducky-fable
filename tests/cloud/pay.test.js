import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main } from '../../packages/cloud/src/functions/orders/pay'

// pay 闸门：openid + 本人订单 + 仅 pending + 金额取库内（不信任前端）+ 超时惰性关单 + PAY_MODE 放行。
// 下单通道 = 支付工作流（cloudbase_module），flowId 存 config.pay。
const WORKFLOW_OK = {
  result: {
    data: {
      timeStamp: '1718000000',
      nonceStr: 'mock-nonce',
      packageVal: 'prepay_id=mock',
      signType: 'RSA',
      paySign: 'mock-sign',
    },
  },
}

beforeEach(() => {
  control.reset()
  control.setOpenId('user-A')
  control.setCallFunctionResult(WORKFLOW_OK)
  control.seed('config', [{ _id: 'pay', mode: 'real', flowId: 'flow-test' }])
  control.seed('orders', [
    { _id: 'o1', id: 'o1', _openid: 'user-A', status: 'pending', amount: 178, createdAt: Date.now(), items: [{ name: '幸运小鸭礼盒' }] },
    { _id: 'o2', id: 'o2', _openid: 'user-A', status: 'paid', amount: 178, createdAt: Date.now(), items: [] },
    { _id: 'o3', id: 'o3', _openid: 'user-A', status: 'pending', amount: 178, createdAt: Date.now() - 16 * 60 * 1000, items: [] },
    { _id: 'o4', id: 'o4', _openid: 'user-A', status: 'pending', amount: 0, createdAt: Date.now(), items: [] },
  ])
})

describe('pay 闸门与发起支付（工作流通道）', () => {
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

  it('PAY_NOT_ENABLED：mock 模式或缺 flowId 一律不放行', async () => {
    control.reset()
    control.setOpenId('user-A')
    control.seed('config', [{ _id: 'pay', mode: 'mock' }])
    control.seed('orders', [{ _id: 'o1', id: 'o1', _openid: 'user-A', status: 'pending', amount: 178, createdAt: Date.now(), items: [] }])
    expect((await main({ id: 'o1' })).error).toBe('PAY_NOT_ENABLED')

    control.reset()
    control.setOpenId('user-A')
    control.seed('config', [{ _id: 'pay', mode: 'real' }]) // 缺 flowId
    control.seed('orders', [{ _id: 'o1', id: 'o1', _openid: 'user-A', status: 'pending', amount: 178, createdAt: Date.now(), items: [] }])
    expect((await main({ id: 'o1' })).error).toBe('PAY_NOT_ENABLED')
  })

  it('超时 pending 惰性关单：返回 ORDER_CLOSED 并落 closed', async () => {
    expect((await main({ id: 'o3' })).error).toBe('ORDER_CLOSED')
    const o3 = control.dump('orders').find((o) => o._id === 'o3')
    expect(o3.status).toBe('closed')
    expect(o3.closedAt).toBeGreaterThan(0)
  })

  it('成功发起：触发工作流（flowId/单号/库内金额/openid），回传 requestPayment 参数', async () => {
    const res = await main({ id: 'o1' })
    expect(res.ok).toBe(true)
    expect(res.payment.package).toBe('prepay_id=mock') // packageVal → package 对齐
    expect(res.payment.signType).toBe('RSA')
    const calls = control.callFunctionCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('cloudbase_module')
    expect(calls[0].data.name).toBe('flow-test')
    expect(calls[0].data.data.out_trade_no).toBe('o1')
    expect(calls[0].data.data.amount).toEqual({ total: 17800, currency: 'CNY' }) // 库内 178 元 → 分
    expect(calls[0].data.data.payer.openid).toBe('user-A')
  })

  it('0 元单（券抵扣到 0）：不走微信，直接置 paid', async () => {
    const res = await main({ id: 'o4' })
    expect(res.ok).toBe(true)
    expect(res.paid).toBe(true)
    expect(control.callFunctionCalls()).toHaveLength(0)
    expect(control.dump('orders').find((o) => o._id === 'o4').status).toBe('paid')
  })

  it('UNIFIED_ORDER_FAIL：工作流无预付单 / 调用异常，订单留 pending', async () => {
    control.setCallFunctionResult({ result: {} })
    expect((await main({ id: 'o1' })).error).toBe('UNIFIED_ORDER_FAIL')
    control.setCallFunctionFail(true)
    expect((await main({ id: 'o1' })).error).toBe('UNIFIED_ORDER_FAIL')
    expect(control.dump('orders').find((o) => o._id === 'o1').status).toBe('pending')
  })
})

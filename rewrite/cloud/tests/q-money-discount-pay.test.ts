// 用了微信/银行立减的单：用户实付 payer_total 小于订单总额 total，但微信收的订单金额就是 total——
// 按 total 核对才对；退款时 amount.total 也必须是微信原单总额，否则微信拒退。
import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { AFTERSALE_STATUS_SPEC } from '@ldrw/shared'
import { main as payCallback } from '../src/functions/callbacks/payCallback'
import { main as adminApi } from '../src/functions/adminApi/index'
import { sha } from '../src/functions/adminApi/lib'

const post = (action: string, data: Record<string, unknown> = {}) =>
  adminApi({
    httpMethod: 'POST',
    headers: { 'x-forwarded-for': '1.1.1.1' },
    body: JSON.stringify({ action, key: 'super-secret-key', data }),
  }).then((r: any) => ({ status: r.statusCode, ...JSON.parse(r.body) }))

beforeEach(() => {
  control.reset()
  control.setOpenId('')
  control.seed('adminConfig', [{ _id: 'auth', keyHash: sha('super-secret-key'), role: 'superadmin', name: '店主' }])
  control.seed('inventory', [{ _id: 'p1__', productId: 'p1', spec: '', stock: 4 }])
  control.seed('orders', [
    {
      _id: 'o1',
      id: 'o1',
      _openid: 'oB',
      amount: 100,
      goods: 100,
      status: 'pending',
      reserved: [{ productId: 'p1', spec: '', qty: 1 }],
      items: [{ productId: 'p1', lineId: 'p1__', spec: '', name: '鸭', price: 100, qty: 1, refundable: true }],
      createdAt: 1,
    },
  ])
})

const discounted = { out_trade_no: 'o1', trade_state: 'SUCCESS', transaction_id: 'txn-1', amount: { total: 10000, payer_total: 9000 } }

describe('优惠单支付回调按订单总额核对', () => {
  it('大白话：立减 10 元的正常单转已付，不进支付异常、不回补库存；实付另存备查', async () => {
    await payCallback(discounted)
    const o = control.dump('orders')[0]
    expect(o.status).toBe('paid')
    expect(o.feeMismatch).toBeUndefined()
    expect(o.payerTotal).toBe(9000)
    expect(control.dump('inventory')[0].stock).toBe(4)
  })

  it('大白话：订单总额真对不上仍进支付异常，paidFee 记微信原单总额', async () => {
    await payCallback({ ...discounted, amount: { total: 8000, payer_total: 7000 } })
    const o = control.dump('orders')[0]
    expect(o.status).toBe('payment_exception')
    expect(o.paidFee).toBe(8000)
    expect(o.payerTotal).toBe(7000)
  })

  it('大白话：这单越规退款时 amount.total 等于原单总额 10000（与微信原单一致）', async () => {
    await payCallback(discounted)
    control.seed('config', [{ _id: 'pay', mode: 'real', refundFlowId: 'flow-refund' }])
    control.setCallFunctionResult({ result: { data: { status: 'PROCESSING', refund_id: 'r1' } } })
    const r = await post('overrideRefund', { orderId: 'o1', lineId: 'p1__', reason: '客服特批' })
    expect(r.ok).toBe(true)
    const sent = control.callFunctionCalls().at(-1).data.data
    expect(sent.amount.total).toBe(10000)
    expect(sent.amount.refund).toBe(10000)
    // 越规退款直接以 approved 建档：声明表的初始态要写上它，声明才和实际一致
    const created = control.dump('afterSales')[0]
    expect(AFTERSALE_STATUS_SPEC.initial as readonly string[]).toContain(created.status)
  })
})

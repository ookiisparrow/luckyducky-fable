// 回调金额字段是脏值（非数字串）时，写进订单的金额只能是数或 null，不能是 NaN：
// NaN 进库后对账/展示按数字读会出「NaN 元」，JSON 往返又变成 null，读写两侧对不上。
import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as payCallback } from '../src/functions/callbacks/payCallback'

const order = (over: Record<string, unknown> = {}) => ({
  _id: 'o1',
  amount: 100,
  status: 'pending',
  reserved: [{ productId: 'p1', spec: '', qty: 1 }],
  createdAt: 1,
  ...over,
})

// 桩落库前会 JSON 克隆（NaN 变 null），只能在写入那一刻看原值
const orderWrites = () => {
  const writes: Record<string, unknown>[] = []
  control.setBeforeUpdate(async ({ coll, data }: any) => {
    if (coll === 'orders') writes.push(data)
  })
  return writes
}
const nanFields = (w: Record<string, unknown>) => Object.keys(w).filter((k) => typeof w[k] === 'number' && Number.isNaN(w[k]))

beforeEach(() => {
  control.reset()
  control.setOpenId('')
})

describe('payCallback：回调金额字段异常不写 NaN', () => {
  it('大白话：关单后晚到、货已被买走进 refund_required——payer_total 是脏值时记 null，不记 NaN', async () => {
    control.seed('orders', [order({ status: 'closed', closedAt: 100 })])
    control.seed('inventory', [{ _id: 'p1__', productId: 'p1', spec: '', stock: 0 }])
    const writes = orderWrites()
    await payCallback({ out_trade_no: 'o1', trade_state: 'SUCCESS', transaction_id: 'txn-1', amount: { total: 10000, payer_total: 'abc' } })
    const rr = writes.find((w) => w.status === 'refund_required')!
    expect(rr).toBeTruthy()
    expect(nanFields(rr)).toEqual([])
    expect(rr).toMatchObject({ paidFee: 10000, payerTotal: null })
  })

  it('大白话：正常支付 payer_total 是脏值——单照常 paid，payerTotal 记 null', async () => {
    control.seed('orders', [order()])
    control.seed('inventory', [{ _id: 'p1__', productId: 'p1', spec: '', stock: 5 }])
    const writes = orderWrites()
    await payCallback({ out_trade_no: 'o1', trade_state: 'SUCCESS', transaction_id: 'txn-1', amount: { total: 10000, payer_total: 'abc' } })
    const paid = writes.find((w) => w.status === 'paid')!
    expect(nanFields(paid)).toEqual([])
    expect(paid.payerTotal).toBeNull()
  })

  it('大白话：payer_total 是合法数字串照常记成数（归一化不误伤正常值）', async () => {
    control.seed('orders', [order()])
    control.seed('inventory', [{ _id: 'p1__', productId: 'p1', spec: '', stock: 5 }])
    await payCallback({ out_trade_no: 'o1', trade_state: 'SUCCESS', transaction_id: 'txn-1', amount: { total: 10000, payer_total: '9000' } })
    expect(control.dump('orders')[0]).toMatchObject({ status: 'paid', payerTotal: 9000 })
  })
})

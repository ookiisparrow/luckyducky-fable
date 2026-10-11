// #400-2/3/4：后台退款动作——异常单同意退款发给微信的总额口径、读失败不冒充「不存在/未配置」、发货竞态回读失败也告警。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { control } from 'wx-server-sdk'
import { COLLECTIONS } from '@ldrw/shared'
import { main as adminApi } from '../src/functions/adminApi/index'
import { sha } from '../src/functions/adminApi/lib'

const post = (action: string, data: Record<string, unknown> = {}) =>
  adminApi({
    httpMethod: 'POST',
    headers: { 'x-forwarded-for': '1.1.1.1' },
    body: JSON.stringify({ action, key: 'super-secret-key', data }),
  }).then((r: any) => ({ status: r.statusCode, ...JSON.parse(r.body) }))

const LINE = { productId: 'p1', lineId: 'p1__红', spec: '红', name: '鸭', price: 100, qty: 2, refundable: true }
const seedOrder = (over: Record<string, unknown> = {}) =>
  control.seed(COLLECTIONS.orders, [
    { _id: 'o1', id: 'o1', _openid: 'oBUYER', status: 'paid', amount: 200, goods: 200, createdAt: 1000, items: [LINE], ...over },
  ])
const seedAS = (over: Record<string, unknown> = {}) =>
  control.seed(COLLECTIONS.afterSales, [
    { _id: 'as1', orderId: 'o1', _openid: 'oBUYER', lineId: 'p1__红', productId: 'p1', qty: 2, refundAmount: 180, status: 'applied', ...over },
  ])
const seedFlow = () => control.seed(COLLECTIONS.config, [{ _id: 'pay', mode: 'real', refundFlowId: 'flow-refund' }])
const acceptFlow = () => control.setCallFunctionResult({ result: { data: { status: 'PROCESSING' } } })
const alerted = (code: string) => control.dump(COLLECTIONS.anomalies).find((a: any) => a.code === code)
const failDoc = (coll: string, id: string) =>
  control.setBeforeGet(async (a: any) => {
    if (a.coll === coll && a.id === id) throw new Error('MOCK_READ_FAIL')
  })

beforeEach(() => {
  control.reset()
  control.setOpenId('')
  control.seed(COLLECTIONS.adminConfig, [{ _id: 'auth', keyHash: sha('super-secret-key'), role: 'superadmin' }])
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('approveRefund 对支付异常单发给微信的总额（#400-2）', () => {
  it('异常单用微信原单总额 paidFee，与越规退款同一口径；按进课降级重算也用它作分母', async () => {
    seedFlow()
    acceptFlow()
    seedOrder({ status: 'payment_exception', paidFee: 18000, items: [{ ...LINE, enteredQty: 1 }] })
    seedAS()
    const r = await post('approveRefund', { id: 'as1' })
    expect(r.ok).toBe(true)
    const amount = control.callFunctionCalls()[0].data.data.amount
    expect(amount.total).toBe(18000)
    expect(amount.refund).toBe(9000) // 剩 1 件：180 元 × 100/200
  })

  it('异常单缺实付额：不抢占、不发微信，回 PAYMENT_AMOUNT_MISSING 并告警', async () => {
    seedFlow()
    acceptFlow()
    seedOrder({ status: 'payment_exception', paidFee: null })
    seedAS()
    expect((await post('approveRefund', { id: 'as1' })).error).toBe('PAYMENT_AMOUNT_MISSING')
    expect(control.dump(COLLECTIONS.afterSales)[0].status).toBe('applied')
    expect(control.callFunctionCalls()).toEqual([])
    expect(alerted('PAYMENT_AMOUNT_MISSING')).toBeTruthy()
  })
})

describe('读失败回 DOC_READ_FAIL，不冒充「不存在/未配置」（#400-3）', () => {
  it('退款流配置读失败：overrideRefund / approveRefund 都回 DOC_READ_FAIL（不是 REFUND_FLOW_NOT_CONFIGURED）', async () => {
    seedFlow()
    seedOrder()
    seedAS()
    failDoc(COLLECTIONS.config, 'pay')
    expect((await post('overrideRefund', { orderId: 'o1', lineId: 'p1__红', reason: 'x' })).error).toBe('DOC_READ_FAIL')
    expect((await post('approveRefund', { id: 'as1' })).error).toBe('DOC_READ_FAIL')
    expect(control.callFunctionCalls()).toEqual([])
  })

  it('订单读失败：overrideRefund / approveRefund / recordPaidFee 都回 DOC_READ_FAIL（不是 NO_ORDER）', async () => {
    seedFlow()
    seedOrder({ status: 'payment_exception' })
    seedAS()
    failDoc(COLLECTIONS.orders, 'o1')
    expect((await post('overrideRefund', { orderId: 'o1', lineId: 'p1__红', reason: 'x' })).error).toBe('DOC_READ_FAIL')
    expect((await post('approveRefund', { id: 'as1' })).error).toBe('DOC_READ_FAIL')
    expect((await post('recordPaidFee', { id: 'o1', paidFeeFen: 19000 })).error).toBe('DOC_READ_FAIL')
    expect(control.dump(COLLECTIONS.afterSales)[0].status).toBe('applied')
    expect(control.callFunctionCalls()).toEqual([])
  })

  it('售后单读失败：getRefundDetail / approveRefund / rejectRefund 都回 DOC_READ_FAIL（不是 NO_RECORD）', async () => {
    seedFlow()
    seedOrder()
    seedAS()
    failDoc(COLLECTIONS.afterSales, 'as1')
    expect((await post('getRefundDetail', { id: 'as1' })).error).toBe('DOC_READ_FAIL')
    expect((await post('approveRefund', { id: 'as1' })).error).toBe('DOC_READ_FAIL')
    expect((await post('rejectRefund', { id: 'as1', reason: 'x' })).error).toBe('DOC_READ_FAIL')
    expect(control.callFunctionCalls()).toEqual([])
  })
})

describe('退款受理后回读订单失败也要告警（#400-4）', () => {
  it('approveRefund：钱照退、回成功，但留「没核上是否被并发发货」告警', async () => {
    seedFlow()
    acceptFlow()
    seedOrder()
    seedAS()
    control.setCallFunctionImpl(async () => failDoc(COLLECTIONS.orders, 'o1'))
    expect((await post('approveRefund', { id: 'as1' })).ok).toBe(true)
    expect(alerted('SHIP_REFUND_RACE_UNCHECKED')).toMatchObject({ ctx: { fn: 'approveRefund', id: 'as1', orderId: 'o1' } })
  })

  it('overrideRefund：同上', async () => {
    seedFlow()
    acceptFlow()
    seedOrder()
    control.setCallFunctionImpl(async () => failDoc(COLLECTIONS.orders, 'o1'))
    const r = await post('overrideRefund', { orderId: 'o1', lineId: 'p1__红', reason: 'x' })
    expect(r.ok).toBe(true)
    expect(alerted('SHIP_REFUND_RACE_UNCHECKED')).toMatchObject({ ctx: { fn: 'overrideRefund', id: r.id, orderId: 'o1' } })
  })
})

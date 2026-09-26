// 变异分诊：adminApi/actions/refunds.ts 存活变异的杀手测试（入参校验、越规退款放行的状态与编号/额度口径、
// 补录实付的边界与并发、列表筛选与买家联查、详情的行判定、审批降级重算、拒绝的状态闸，以及各告警落账的函数名与上下文）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import cloud, { control } from 'wx-server-sdk'
import { COLLECTIONS } from '@ldrw/shared'
import { main as adminApi } from '../src/functions/adminApi/index'
import { sha } from '../src/functions/adminApi/lib'

const post = (action: string, data: Record<string, unknown> = {}) =>
  adminApi({
    httpMethod: 'POST',
    headers: { 'x-forwarded-for': '1.1.1.1' },
    body: JSON.stringify({ action, key: 'super-secret-key', data }),
  }).then((r: any) => ({ status: r.statusCode, ...JSON.parse(r.body) }))

const LINE_A = { productId: 'p1', lineId: 'p1__红', spec: '红', name: '鸭', price: 50, qty: 1, refundable: true }
const LINE_B = { productId: 'p2', lineId: 'p2__', spec: '', name: '兔', price: 50, qty: 1, refundable: true }
const seedOrder = (over: Record<string, unknown> = {}) =>
  control.seed(COLLECTIONS.orders, [
    { _id: 'o1', id: 'o1', _openid: 'oBUYER', status: 'paid', amount: 100, goods: 100, createdAt: 1000, items: [LINE_A, LINE_B], ...over },
  ])
const seedAS = (over: Record<string, unknown> = {}) =>
  control.seed(COLLECTIONS.afterSales, [
    { _id: 'as1', orderId: 'o1', _openid: 'oBUYER', lineId: 'p1__红', productId: 'p1', qty: 1, refundAmount: 50, status: 'applied', ...over },
  ])
const seedFlow = () => control.seed(COLLECTIONS.config, [{ _id: 'pay', mode: 'real', refundFlowId: 'flow-refund' }])
const acceptFlow = () => control.setCallFunctionResult({ result: { data: { status: 'PROCESSING' } } })
const flowData = (i = 0) => control.callFunctionCalls()[i].data.data
const asDoc = (id: string) => control.dump(COLLECTIONS.afterSales).find((a: any) => a._id === id)
const anomaly = (code: string) => {
  const a = control.dump(COLLECTIONS.anomalies).find((x: any) => x.code === code)
  return a && { kind: a.kind, ctx: a.ctx }
}
const fillScanCap = () =>
  control.seed(
    COLLECTIONS.afterSales,
    Array.from({ length: 1000 }, (_, i) => ({ _id: 'f' + i, orderId: 'o1', lineId: 'x' + i, status: 'rejected', refundAmount: 0 }))
  )
// 并发方在这次条件写之前抢先改了单（内层写不带被拦的字段，不会再触发）
const raceBefore = (coll: string, match: (data: any) => boolean, id: string, patch: Record<string, unknown>) =>
  control.setBeforeUpdate(async (a: any) => {
    if (a.coll === coll && match(a.data)) await cloud.database().collection(coll).doc(id).update({ data: patch })
  })

beforeEach(() => {
  control.reset()
  control.setOpenId('')
  control.seed(COLLECTIONS.adminConfig, [{ _id: 'auth', keyHash: sha('super-secret-key'), role: 'superadmin' }])
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('overrideRefund', () => {
  it('缺订单号、缺行号、理由只有空格：都回 BAD_ARGS', async () => {
    expect((await post('overrideRefund', { lineId: 'p1__红', reason: 'x' })).error).toBe('BAD_ARGS')
    expect((await post('overrideRefund', { orderId: 'o1', reason: 'x' })).error).toBe('BAD_ARGS')
    expect((await post('overrideRefund', { orderId: 'o1', lineId: 'p1__红', reason: '   ' })).error).toBe('BAD_ARGS')
  })

  it('已付款、已发货的单都放行；售后单用本行基础编号、存规格快照、理由截 100，发给微信的理由截 80', async () => {
    seedFlow()
    acceptFlow()
    seedOrder()
    const reason = '理'.repeat(150)
    expect((await post('overrideRefund', { orderId: 'o1', lineId: 'p1__红', reason })).ok).toBe(true)
    const rec = asDoc('o1__p1__红')
    expect(rec.spec).toBe('红')
    expect(rec.reason).toBe('理'.repeat(100))
    expect(flowData().reason).toBe('理'.repeat(80))

    control.reset()
    control.seed(COLLECTIONS.adminConfig, [{ _id: 'auth', keyHash: sha('super-secret-key'), role: 'superadmin' }])
    seedFlow()
    acceptFlow()
    seedOrder({ status: 'shipped' })
    expect((await post('overrideRefund', { orderId: 'o1', lineId: 'p2__', reason: 'x' })).ok).toBe(true)
    expect(asDoc('o1__p2__').spec).toBe('')
  })

  it('已完成（确认收货）的单也放行', async () => {
    seedFlow()
    acceptFlow()
    seedOrder({ status: 'done' })
    expect((await post('overrideRefund', { orderId: 'o1', lineId: 'p1__红', reason: 'x' })).ok).toBe(true)
  })

  it('别的行有被拒的售后：本行照用基础编号，被拒那笔也不占全单已退额度', async () => {
    seedFlow()
    acceptFlow()
    seedOrder()
    control.seed(COLLECTIONS.afterSales, [{ _id: 'o1__p2__', orderId: 'o1', lineId: 'p2__', status: 'rejected', refundAmount: 80 }])
    const r = await post('overrideRefund', { orderId: 'o1', lineId: 'p1__红', reason: 'x' })
    expect(r.id).toBe('o1__p1__红')
    expect(asDoc('o1__p1__红').refundAmount).toBe(50)
  })

  it('支付异常单缺实付额：拒退并告警（带函数名与订单号）', async () => {
    seedFlow()
    seedOrder({ status: 'payment_exception' })
    expect((await post('overrideRefund', { orderId: 'o1', lineId: 'p1__红', reason: 'x' })).error).toBe('PAYMENT_AMOUNT_MISSING')
    expect(anomaly('PAYMENT_AMOUNT_MISSING')).toEqual({ kind: 'flow-failure', ctx: { fn: 'overrideRefund', orderId: 'o1' } })
  })

  it('售后单写失败（读回也没有）：500 且告警带售后单号', async () => {
    seedFlow()
    seedOrder()
    control.setBeforeAdd(async ({ coll }: any) => {
      if (coll === COLLECTIONS.afterSales) throw new Error('MOCK_ADD_FAIL')
    })
    expect((await post('overrideRefund', { orderId: 'o1', lineId: 'p1__红', reason: 'x' })).error).toBe('WRITE_FAIL')
    expect(anomaly('AFTERSALE_WRITE_FAIL')).toEqual({ kind: 'flow-failure', ctx: { fn: 'overrideRefund', id: 'o1__p1__红' } })
    expect(control.callFunctionCalls()).toEqual([])
  })

  it('退款流没受理且回滚也写不进：两条告警都带函数名与售后单号', async () => {
    seedFlow()
    seedOrder()
    control.setBeforeUpdate(async ({ coll, data }: any) => {
      if (coll === COLLECTIONS.afterSales && data.status === 'applied') throw new Error('MOCK_WRITE_FAIL')
    })
    expect((await post('overrideRefund', { orderId: 'o1', lineId: 'p1__红', reason: 'x' })).error).toBe('REFUND_TRIGGER_FAIL')
    const ctx = { fn: 'overrideRefund', id: 'o1__p1__红' }
    expect(anomaly('REFUND_TRIGGER_FAIL')).toEqual({ kind: 'flow-failure', ctx })
    expect(anomaly('REFUND_ROLLBACK_FAIL')).toEqual({ kind: 'flow-failure', ctx })
  })

  it('期间没人发货：不报 SHIP_REFUND_RACE；开始时就已发货的单也不报', async () => {
    seedFlow()
    acceptFlow()
    seedOrder()
    expect((await post('overrideRefund', { orderId: 'o1', lineId: 'p1__红', reason: 'x' })).ok).toBe(true)
    expect(anomaly('SHIP_REFUND_RACE')).toBeUndefined()
    control.reset()
    control.seed(COLLECTIONS.adminConfig, [{ _id: 'auth', keyHash: sha('super-secret-key'), role: 'superadmin' }])
    seedFlow()
    acceptFlow()
    seedOrder({ status: 'shipped' })
    expect((await post('overrideRefund', { orderId: 'o1', lineId: 'p1__红', reason: 'x' })).ok).toBe(true)
    expect(anomaly('SHIP_REFUND_RACE')).toBeUndefined()
  })

  it('退款期间订单被并发发货：告警 SHIP_REFUND_RACE（带售后单号与订单号）', async () => {
    seedFlow()
    acceptFlow()
    seedOrder()
    control.setCallFunctionImpl(async () => {
      await cloud.database().collection(COLLECTIONS.orders).doc('o1').update({ data: { status: 'shipped' } })
    })
    expect((await post('overrideRefund', { orderId: 'o1', lineId: 'p1__红', reason: 'x' })).ok).toBe(true)
    expect(anomaly('SHIP_REFUND_RACE')).toEqual({ kind: 'flow-failure', ctx: { fn: 'overrideRefund', id: 'o1__p1__红', orderId: 'o1' } })
  })
})

describe('同单售后触顶（AFTERSALE_SCAN_CAP）：三个入口各自告警带自己的函数名', () => {
  it('overrideRefund', async () => {
    seedFlow()
    seedOrder()
    fillScanCap()
    expect((await post('overrideRefund', { orderId: 'o1', lineId: 'p1__红', reason: 'x' })).error).toBe('REFUND_SCAN_CAP')
    expect(anomaly('AFTERSALE_SCAN_CAP')).toEqual({ kind: 'flow-failure', ctx: { fn: 'overrideRefund', orderId: 'o1' } })
  })

  it('recordPaidFee', async () => {
    seedOrder({ status: 'payment_exception' })
    fillScanCap()
    expect((await post('recordPaidFee', { id: 'o1', paidFeeFen: 10000 })).error).toBe('REFUND_SCAN_CAP')
    expect(anomaly('AFTERSALE_SCAN_CAP')).toEqual({ kind: 'flow-failure', ctx: { fn: 'recordPaidFee', orderId: 'o1' } })
  })

  it('approveRefund（审批时要降级重算才会读）', async () => {
    seedFlow()
    seedOrder({ items: [{ ...LINE_A, qty: 2, enteredQty: 1 }] })
    seedAS({ qty: 2 })
    fillScanCap()
    expect((await post('approveRefund', { id: 'as1' })).error).toBe('REFUND_SCAN_CAP')
    expect(anomaly('AFTERSALE_SCAN_CAP')).toEqual({ kind: 'flow-failure', ctx: { fn: 'approveRefund', orderId: 'o1' } })
  })
})

describe('recordPaidFee', () => {
  it('缺单号、金额为 0：BAD_ARGS', async () => {
    seedOrder({ status: 'payment_exception' })
    expect((await post('recordPaidFee', { paidFeeFen: 100 })).error).toBe('BAD_ARGS')
    expect((await post('recordPaidFee', { id: 'o1', paidFeeFen: 0 })).error).toBe('BAD_ARGS')
  })

  it('订单应付是 0：拒补录并告警（带单号、补录额、应付额）', async () => {
    seedOrder({ status: 'payment_exception', amount: 0 })
    expect((await post('recordPaidFee', { id: 'o1', paidFeeFen: 100 })).error).toBe('BAD_AMOUNT')
    expect(anomaly('BAD_AMOUNT_RANGE')).toEqual({ kind: 'flow-failure', ctx: { fn: 'recordPaidFee', id: 'o1', paidFee: '100', expectedFen: '0' } })
  })

  it('恰好应付的 20 倍：允许；记下补录人', async () => {
    seedOrder({ status: 'payment_exception' })
    expect((await post('recordPaidFee', { id: 'o1', paidFeeFen: 10000 * 20 })).ok).toBe(true)
    const o = control.dump(COLLECTIONS.orders)[0]
    expect(o.paidFee).toBe(200000)
    expect(o.paidFeeRecordedBy).toBe('admin')
  })

  it('读完到写之间订单被并发推进：409 CONCURRENT 并告警', async () => {
    seedOrder({ status: 'payment_exception' })
    raceBefore(COLLECTIONS.orders, (d) => 'paidFee' in d, 'o1', { status: 'refund_required' })
    const r = await post('recordPaidFee', { id: 'o1', paidFeeFen: 10000 })
    expect(r.status).toBe(409)
    expect(r.error).toBe('CONCURRENT')
    expect(anomaly('RECORD_FAIL')).toEqual({ kind: 'flow-failure', ctx: { fn: 'recordPaidFee', id: 'o1' } })
  })
})

describe('listRefunds', () => {
  const ids = (r: any) => r.list.map((a: any) => a._id)

  it('按申请时间倒序；status 只回该状态、all 回全部；q 两头空格去掉后按订单号精确查', async () => {
    control.seed(COLLECTIONS.afterSales, [
      { _id: 'a1', orderId: 'o1', status: 'applied', appliedAt: 1 },
      { _id: 'a3', orderId: 'o2', status: 'approved', appliedAt: 3 },
      { _id: 'a2', orderId: 'o3', status: 'applied', appliedAt: 2 },
    ])
    expect(ids(await post('listRefunds'))).toEqual(['a3', 'a2', 'a1'])
    expect(ids(await post('listRefunds', { status: 'applied' }))).toEqual(['a2', 'a1'])
    expect(ids(await post('listRefunds', { status: 'all' }))).toEqual(['a3', 'a2', 'a1'])
    expect(ids(await post('listRefunds', { q: '  o2  ' }))).toEqual(['a3'])
  })

  it('买家联查：订单只有 _id 也能对上；没地址、地址为 null、地址缺姓名、订单不存在都给空串', async () => {
    control.seed(COLLECTIONS.orders, [
      { _id: 'o1', address: { name: '张三', phone: '138' } },
      { _id: 'o2', id: 'o2' },
      { _id: 'o3', id: 'o3', address: { phone: '139' } },
      { _id: 'o4', id: 'o4', address: null },
    ])
    control.seed(COLLECTIONS.afterSales, [
      { _id: 'a1', orderId: 'o1', appliedAt: 4 },
      { _id: 'a2', orderId: 'o2', appliedAt: 3 },
      { _id: 'a3', orderId: 'o3', appliedAt: 2 },
      { _id: 'a4', orderId: 'ghost', appliedAt: 1 },
      { _id: 'a5', orderId: 'o4', appliedAt: 0 },
    ])
    const r = await post('listRefunds')
    expect(r.list.map((a: any) => [a._id, a.buyerName, a.buyerPhone])).toEqual([
      ['a1', '张三', '138'],
      ['a2', '', ''],
      ['a3', '', '139'],
      ['a4', '', ''],
      ['a5', '', ''],
    ])
  })
})

describe('getRefundDetail', () => {
  it('缺 id：BAD_ARGS', async () => {
    expect((await post('getRefundDetail', {})).error).toBe('BAD_ARGS')
  })

  it('按售后单自己的行判定：同单另一行可退不影响本行', async () => {
    seedOrder({ items: [LINE_B, { ...LINE_A, refundable: false }] })
    seedAS()
    const r = await post('getRefundDetail', { id: 'as1' })
    expect(r.lineRefundable).toBe(false)
  })

  it('行未标不可退但已全部进课：不可退、剩余 0 件', async () => {
    seedOrder({ items: [{ ...LINE_A, qty: 2, enteredQty: 2 }] })
    seedAS()
    const r = await post('getRefundDetail', { id: 'as1' })
    expect(r.lineRefundable).toBe(false)
    expect(r.refundableQty).toBe(0)
  })
})

describe('approveRefund', () => {
  it('申请后又进课 1 件（3 件剩 2 件）：按 2 件重算金额后再退', async () => {
    seedFlow()
    acceptFlow()
    seedOrder({ items: [{ ...LINE_A, price: 30, qty: 3, enteredQty: 1 }] })
    seedAS({ qty: 3, refundAmount: 90 })
    expect((await post('approveRefund', { id: 'as1' })).ok).toBe(true)
    expect(asDoc('as1')).toMatchObject({ qty: 2, itemTotal: 60, refundAmount: 60 })
    expect(flowData().amount.refund).toBe(6000)
  })

  it('售后单没写理由：发给微信的理由用「用户申请退款」', async () => {
    seedFlow()
    acceptFlow()
    seedOrder()
    seedAS()
    expect((await post('approveRefund', { id: 'as1' })).ok).toBe(true)
    expect(flowData().reason).toBe('用户申请退款')
  })

  it('售后单理由很长：发给微信的截 80 字', async () => {
    seedFlow()
    acceptFlow()
    seedOrder()
    seedAS({ reason: '长'.repeat(120) })
    expect((await post('approveRefund', { id: 'as1' })).ok).toBe(true)
    expect(flowData().reason).toBe('长'.repeat(80))
  })

  it('本行已全部进课（没标不可退）：ENTERED_NOT_REFUNDABLE，不退', async () => {
    seedFlow()
    acceptFlow()
    seedOrder({ items: [{ ...LINE_A, enteredQty: 1 }, LINE_B] })
    seedAS()
    expect((await post('approveRefund', { id: 'as1' })).error).toBe('ENTERED_NOT_REFUNDABLE')
    expect(asDoc('as1').status).toBe('applied')
    expect(control.callFunctionCalls()).toEqual([])
  })

  it('只标了不可退、没记进课件数（旧单）：ENTERED_NOT_REFUNDABLE', async () => {
    seedFlow()
    acceptFlow()
    seedOrder({ items: [{ ...LINE_A, refundable: false }, LINE_B] })
    seedAS()
    expect((await post('approveRefund', { id: 'as1' })).error).toBe('ENTERED_NOT_REFUNDABLE')
  })

  it('同单另一行已全部进课：不影响本行照常退', async () => {
    seedFlow()
    acceptFlow()
    seedOrder({ items: [{ ...LINE_A, refundable: false, enteredQty: 1 }, LINE_B] })
    seedAS({ _id: 'as2', lineId: 'p2__', productId: 'p2' })
    expect((await post('approveRefund', { id: 'as2' })).ok).toBe(true)
  })

  it('售后单的行在订单里找不到：不按进课拦，照常退', async () => {
    seedFlow()
    acceptFlow()
    seedOrder()
    seedAS({ lineId: 'gone__', productId: 'gone' })
    expect((await post('approveRefund', { id: 'as1' })).ok).toBe(true)
    expect(flowData().amount.refund).toBe(5000)
  })

  it('退款已受理后回读订单失败：照样回成功（钱已在退），不报 SHIP_REFUND_RACE', async () => {
    seedFlow()
    acceptFlow()
    seedOrder()
    seedAS()
    control.setCallFunctionImpl(async () => {
      await cloud.database().collection(COLLECTIONS.orders).doc('o1').remove()
    })
    expect((await post('approveRefund', { id: 'as1' })).ok).toBe(true)
    expect(anomaly('SHIP_REFUND_RACE')).toBeUndefined()
  })

  it('期间没人发货：不报 SHIP_REFUND_RACE', async () => {
    seedFlow()
    acceptFlow()
    seedOrder()
    seedAS()
    expect((await post('approveRefund', { id: 'as1' })).ok).toBe(true)
    expect(anomaly('SHIP_REFUND_RACE')).toBeUndefined()
  })

  it('退款期间订单被并发发货：告警 SHIP_REFUND_RACE（带 approveRefund、售后单号与订单号）', async () => {
    seedFlow()
    acceptFlow()
    seedOrder()
    seedAS()
    control.setCallFunctionImpl(async () => {
      await cloud.database().collection(COLLECTIONS.orders).doc('o1').update({ data: { status: 'shipped' } })
    })
    expect((await post('approveRefund', { id: 'as1' })).ok).toBe(true)
    expect(anomaly('SHIP_REFUND_RACE')).toEqual({ kind: 'flow-failure', ctx: { fn: 'approveRefund', id: 'as1', orderId: 'o1' } })
  })

  it('抢占时已被并发处理：BAD_STATUS:concurrent', async () => {
    seedFlow()
    seedOrder()
    seedAS()
    raceBefore(COLLECTIONS.afterSales, (d) => d.status === 'approved', 'as1', { status: 'rejected' })
    expect((await post('approveRefund', { id: 'as1' })).error).toBe('BAD_STATUS:concurrent')
  })

  it('退款流没受理且回滚写不进：两条告警都带 approveRefund 与售后单号', async () => {
    seedFlow()
    seedOrder()
    seedAS()
    control.setBeforeUpdate(async ({ coll, data }: any) => {
      if (coll === COLLECTIONS.afterSales && data.status === 'applied') throw new Error('MOCK_WRITE_FAIL')
    })
    expect((await post('approveRefund', { id: 'as1' })).error).toBe('REFUND_TRIGGER_FAIL')
    const ctx = { fn: 'approveRefund', id: 'as1' }
    expect(anomaly('REFUND_TRIGGER_FAIL')).toEqual({ kind: 'flow-failure', ctx })
    expect(anomaly('REFUND_ROLLBACK_FAIL')).toEqual({ kind: 'flow-failure', ctx })
  })

  it('回滚已写成功、之后读库出错：不报回滚失败', async () => {
    seedFlow()
    seedOrder()
    seedAS()
    let rolledBack = false
    control.setBeforeUpdate(async ({ coll, data }: any) => {
      if (coll === COLLECTIONS.afterSales && data.status === 'applied') rolledBack = true
    })
    control.setBeforeGet(async ({ coll, id }: any) => {
      if (rolledBack && coll === COLLECTIONS.afterSales && id) throw new Error('NETWORK_TIMEOUT')
    })
    expect((await post('approveRefund', { id: 'as1' })).error).toBe('REFUND_TRIGGER_FAIL')
    expect(asDoc('as1').status).toBe('applied')
    expect(anomaly('REFUND_ROLLBACK_FAIL')).toBeUndefined()
  })
})

describe('rejectRefund', () => {
  it('缺 id、理由只有空格：BAD_ARGS；售后单不存在：NO_RECORD', async () => {
    expect((await post('rejectRefund', { reason: 'x' })).error).toBe('BAD_ARGS')
    expect((await post('rejectRefund', { id: 'as1', reason: '   ' })).error).toBe('BAD_ARGS')
    expect((await post('rejectRefund', { id: 'ghost', reason: 'x' })).error).toBe('NO_RECORD')
  })

  it('已批准的单不能拒：BAD_STATUS:approved', async () => {
    seedAS({ status: 'approved' })
    expect((await post('rejectRefund', { id: 'as1', reason: 'x' })).error).toBe('BAD_STATUS:approved')
  })

  it('拒绝成功：状态 rejected，理由截 100', async () => {
    seedAS()
    expect((await post('rejectRefund', { id: 'as1', reason: '拒'.repeat(150) })).ok).toBe(true)
    expect(asDoc('as1')).toMatchObject({ status: 'rejected', rejectReason: '拒'.repeat(100) })
  })

  it('读完到写之间被并发批准：BAD_STATUS:concurrent，不把已批准改回拒绝', async () => {
    seedAS()
    raceBefore(COLLECTIONS.afterSales, (d) => d.status === 'rejected', 'as1', { status: 'approved' })
    expect((await post('rejectRefund', { id: 'as1', reason: 'x' })).error).toBe('BAD_STATUS:concurrent')
    expect(asDoc('as1').status).toBe('approved')
  })
})

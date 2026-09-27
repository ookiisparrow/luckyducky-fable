// 钱链「读失败≠空态」回归（病根#14）：读失败注入非缺档故障（setBeforeGet/Count 抛 MOCK_READ_FAIL），
// 与缺档（DOCUMENT_NOT_FOUND）/集合未建（COLLECTION_NOT_EXIST）区分。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { generateKeyPairSync } from 'crypto'
import cloud, { control } from 'wx-server-sdk'
import { COLLECTIONS } from '@ldrw/shared'
import { main as app } from '../src/functions/app/index'
import { main as adminApi } from '../src/functions/adminApi/index'
import { sha } from '../src/functions/adminApi/lib'
import { main as payCallback } from '../src/functions/callbacks/payCallback'
import { main as refundCallback } from '../src/functions/callbacks/refundCallback'
import { runBillReconcile } from '../src/functions/timers/billReconcile'
import { getDb, refundNoFor, RECON_WINDOW_MAX } from '../src/kit'

const db = cloud.database()
const post = (action: string, data: Record<string, unknown> = {}) =>
  adminApi({
    httpMethod: 'POST',
    headers: { 'x-forwarded-for': '1.1.1.1' },
    body: JSON.stringify({ action, key: 'super-secret-key', data }),
  }).then((r: any) => ({ status: r.statusCode, ...JSON.parse(r.body) }))
const call = (action: string, data: Record<string, unknown> = {}) => app({ action, data }) as Promise<any>

const failReads = (pred: (a: any) => boolean, msg = 'MOCK_READ_FAIL') =>
  control.setBeforeGet(async (a: any) => {
    if (pred(a)) throw new Error(msg)
  })
const alerted = (code: string) => control.dump('anomalies').some((a: any) => a.code === code)

const seedOrder = (over: Record<string, unknown> = {}) =>
  control.seed('orders', [
    {
      _id: 'o1',
      id: 'o1',
      _openid: 'oBUYER',
      status: 'paid',
      amount: 178,
      goods: 198,
      transactionId: 'wx-t1',
      createdAt: 1000,
      items: [{ productId: 'p1', lineId: 'p1__红', spec: '红', name: '鸭', price: 198, qty: 2, refundable: true }],
      ...over,
    },
  ])
const seedFlow = () => control.seed('config', [{ _id: 'pay', mode: 'real', refundFlowId: 'flow-refund' }])
const afterSalesScan = (a: any) => a.coll === 'afterSales' && !!a.filter

beforeEach(() => {
  control.reset()
  control.setOpenId('')
  control.seed('adminConfig', [{ _id: 'auth', keyHash: sha('super-secret-key'), role: 'superadmin' }])
})

describe('退款封顶：同单售后读失败不当「没有售后」（used=0 会退超）', () => {
  it('applyRefund：读失败 → INTERNAL，不落售后单', async () => {
    control.setOpenId('oBUYER')
    seedOrder()
    failReads(afterSalesScan)
    const r = await call('applyRefund', { orderId: 'o1', lineId: 'p1__红' })
    expect(r.error).toBe('INTERNAL')
    expect(control.dump('afterSales')).toEqual([])
  })

  it('overrideRefund：读失败 → 500，不建单不触发退款', async () => {
    seedOrder()
    seedFlow()
    control.setCallFunctionResult({ result: { data: { status: 'PROCESSING', refund_id: 'r1' } } })
    failReads(afterSalesScan)
    const r = await post('overrideRefund', { orderId: 'o1', lineId: 'p1__红', reason: '特批' })
    expect(r.status).toBe(500)
    expect(control.dump('afterSales')).toEqual([])
    expect(control.callFunctionCalls()).toEqual([])
  })

  it('recordPaidFee：读失败 → 500，不改实付分母（REFUND_EXISTS 锁不被绕过）', async () => {
    seedOrder({ status: 'payment_exception', paidFee: null })
    failReads(afterSalesScan)
    const r = await post('recordPaidFee', { id: 'o1', paidFeeFen: 17700 })
    expect(r.status).toBe(500)
    expect(control.dump('orders')[0].paidFee).toBe(null)
  })

  it('recordPaidFee：afterSales 集合还没建＝真没有售后，照常补录', async () => {
    seedOrder({ status: 'payment_exception', paidFee: null })
    failReads(afterSalesScan, 'DATABASE_COLLECTION_NOT_EXIST: afterSales')
    const r = await post('recordPaidFee', { id: 'o1', paidFeeFen: 17700 })
    expect(r.ok).toBe(true)
    expect(control.dump('orders')[0].paidFee).toBe(17700)
  })

  it('approveRefund 降级重算：读失败 → 500，售后单仍 applied、不打款', async () => {
    seedOrder({ items: [{ productId: 'p1', lineId: 'p1__红', spec: '红', name: '鸭', price: 198, qty: 2, enteredQty: 1, refundable: true }] })
    control.seed('afterSales', [
      { _id: 'as1', orderId: 'o1', _openid: 'oBUYER', lineId: 'p1__红', productId: 'p1', qty: 2, refundAmount: 178, status: 'applied', appliedAt: 2000 },
    ])
    seedFlow()
    control.setCallFunctionResult({ result: { data: { status: 'PROCESSING', refund_id: 'r1' } } })
    failReads(afterSalesScan)
    const r = await post('approveRefund', { id: 'as1' })
    expect(r.status).toBe(500)
    expect(control.dump('afterSales')[0].status).toBe('applied')
    expect(control.callFunctionCalls()).toEqual([])
  })
})

describe('退款三处售后读齐合并后行为不变（触顶 fail-closed + 告警）', () => {
  const fill = () =>
    control.seed('afterSales', Array.from({ length: 1000 }, (_, i) => ({ _id: 'o1__x' + i, orderId: 'o1', status: 'rejected', refundAmount: 0 })))

  it('overrideRefund / recordPaidFee / approveRefund 触顶 → REFUND_SCAN_CAP + AFTERSALE_SCAN_CAP 告警', async () => {
    seedOrder({ status: 'payment_exception', paidFee: 17800, items: [{ productId: 'p1', lineId: 'p1__红', spec: '红', name: '鸭', price: 198, qty: 2, enteredQty: 1, refundable: true }] })
    seedFlow()
    fill()
    expect((await post('overrideRefund', { orderId: 'o1', lineId: 'p1__红', reason: '特批' })).error).toBe('REFUND_SCAN_CAP')
    expect((await post('recordPaidFee', { id: 'o1', paidFeeFen: 17700 })).error).toBe('REFUND_SCAN_CAP')
    control.seed('afterSales', [{ _id: 'as1', orderId: 'o1', lineId: 'p1__红', productId: 'p1', qty: 2, refundAmount: 178, status: 'applied' }])
    expect((await post('approveRefund', { id: 'as1' })).error).toBe('REFUND_SCAN_CAP')
    expect(control.dump('anomalies').filter((a: any) => a.code === 'AFTERSALE_SCAN_CAP').length).toBeGreaterThan(0)
    expect(control.callFunctionCalls()).toEqual([])
  })
})

describe('overrideRefund 回滚失败不静默', () => {
  it('退款流未受理且回滚写失败 → REFUND_ROLLBACK_FAIL 告警（卡 approved 可被发现）', async () => {
    seedOrder()
    seedFlow()
    control.setCallFunctionResult({ result: {} }) // 未受理
    control.setBeforeUpdate(async ({ coll, data }: any) => {
      if (coll === 'afterSales' && data.status === 'applied') throw new Error('MOCK_WRITE_FAIL')
    })
    const r = await post('overrideRefund', { orderId: 'o1', lineId: 'p1__红', reason: '特批' })
    expect(r.error).toBe('REFUND_TRIGGER_FAIL')
    expect(control.dump('afterSales')[0].status).toBe('approved')
    expect(alerted('REFUND_ROLLBACK_FAIL')).toBe(true)
  })

  it('回滚写失败且读回也失败 → 仍告警 REFUND_ROLLBACK_FAIL（辨别不了按可能卡 approved 报）', async () => {
    seedOrder()
    seedFlow()
    control.setCallFunctionResult({ result: {} })
    control.setBeforeUpdate(async ({ coll, data }: any) => {
      if (coll === 'afterSales' && data.status === 'applied') throw new Error('MOCK_WRITE_FAIL')
    })
    failReads((a) => a.coll === 'afterSales' && !!a.id)
    const r = await post('overrideRefund', { orderId: 'o1', lineId: 'p1__红', reason: '特批' })
    expect(r.error).toBe('REFUND_TRIGGER_FAIL')
    expect(alerted('REFUND_ROLLBACK_FAIL')).toBe(true)
  })

  it('回调已抢先置 refunded（回滚未命中但读回成功）→ 不报 REFUND_ROLLBACK_FAIL', async () => {
    seedOrder()
    seedFlow()
    control.setCallFunctionResult({ result: {} })
    control.setCallFunctionImpl(async () => {
      await db.collection('afterSales').where({ orderId: 'o1' }).update({ data: { status: 'refunded' } })
    })
    const r = await post('overrideRefund', { orderId: 'o1', lineId: 'p1__红', reason: '特批' })
    expect(r.error).toBe('REFUND_TRIGGER_FAIL')
    expect(alerted('REFUND_ROLLBACK_FAIL')).toBe(false)
  })
})

describe('shipOne 退款闸：读失败拒发，集合未建放行', () => {
  it('afterSales 读失败 → REFUND_HOLD_READ_FAIL，订单仍 paid', async () => {
    seedOrder()
    failReads(afterSalesScan)
    const r = await post('shipOrder', { id: 'o1', company: '顺丰', trackingNo: 'SF1' })
    expect(r.error).toBe('REFUND_HOLD_READ_FAIL')
    expect(r.status).toBe(503) // 读库失败与 DOC_READ_FAIL 同组：暂时不可用、稍后重试
    expect(control.dump('orders')[0].status).toBe('paid')
  })

  it('批量发货里一单读失败只挂这一单', async () => {
    seedOrder()
    seedOrder({ _id: 'o2', id: 'o2' })
    failReads((a) => afterSalesScan(a) && a.filter.orderId === 'o1')
    const r = await post('shipOrders', { company: '顺丰', items: [{ id: 'o1', trackingNo: 'SF1' }, { id: 'o2', trackingNo: 'SF2' }] })
    expect(r.results.map((x: any) => x.error || 'ok')).toEqual(['REFUND_HOLD_READ_FAIL', 'ok'])
  })

  it('afterSales 集合还没建＝没有退款，照常发货', async () => {
    seedOrder()
    failReads(afterSalesScan, 'DATABASE_COLLECTION_NOT_EXIST: afterSales')
    const r = await post('shipOrder', { id: 'o1', company: '顺丰', trackingNo: 'SF1' })
    expect(r.ok).toBe(true)
    expect(control.dump('orders')[0].status).toBe('shipped')
  })
})

describe('对账页：读失败不显示成「零收入 / 全平 / 全是微信有我方无」', () => {
  const d1 = Date.parse('2026-07-01T04:00:00Z')
  const paidRowsQuery = (a: any) => a.coll === 'orders' && a.filter && a.filter.status && a.filter.status.__op === 'in'

  it('getReconciliation：每日明细读失败 → partial:true + RECON_READ_FAIL 告警', async () => {
    control.seed('orders', [{ _id: 'r1', id: 'r1', _openid: 'x', status: 'paid', amount: 100, paidAt: d1, createdAt: d1, items: [] }])
    failReads(paidRowsQuery)
    const r = await post('getReconciliation', { from: '2026-07-01', to: '2026-07-01' })
    expect(r.ok).toBe(true)
    expect(r.partial).toBe(true)
    expect(alerted('RECON_READ_FAIL')).toBe(true)
  })

  it('getReconciliation：退款明细读失败 → partial:true + RECON_READ_FAIL 告警', async () => {
    control.seed('afterSales', [{ _id: 'a1', orderId: 'r1', status: 'refunded', refundAmount: 30, refundedAt: d1, appliedAt: d1 }])
    failReads((a) => a.coll === 'afterSales' && a.filter && a.filter.status === 'refunded')
    const r = await post('getReconciliation', { from: '2026-07-01', to: '2026-07-01' })
    expect(r.partial).toBe(true)
    expect(alerted('RECON_READ_FAIL')).toBe(true)
  })

  it('getReconciliation：窗内已付单超读取上限 → approx:true', async () => {
    control.seed(
      'orders',
      Array.from({ length: RECON_WINDOW_MAX + 1 }, (_, i) => ({ _id: 'c' + i, id: 'c' + i, _openid: 'x', status: 'paid', amount: 1, paidAt: d1 + i, createdAt: 1, items: [] }))
    )
    const r = await post('getReconciliation', { from: '2026-07-01', to: '2026-07-01' })
    expect(r.approx).toBe(true)
  })

  it('getBillMatch：我方订单读失败 → 500，不把微信流水全列成 wxOnly', async () => {
    control.seed('wxBills', [{ _id: '2026-07-01:tx-1', date: '2026-07-01', transactionId: 'tx-1', orderAmount: 100, outTradeNo: 'm1', tradeState: 'SUCCESS' }])
    failReads(paidRowsQuery)
    const r = await post('getBillMatch', { from: '2026-07-01', to: '2026-07-01' })
    expect(r.status).toBe(500)
    expect(r.discrepancies).toBeUndefined()
  })

  it('getBillMatch：wxBills 读失败 → 500，不假装全平', async () => {
    failReads((a) => a.coll === 'wxBills')
    const r = await post('getBillMatch', { from: '2026-07-01', to: '2026-07-01' })
    expect(r.status).toBe(500)
  })

  it('getBillMatch：wxBills 集合还没建（从没拉过账单）＝合法空态', async () => {
    failReads((a) => a.coll === 'wxBills', 'DATABASE_COLLECTION_NOT_EXIST: wxBills')
    const r = await post('getBillMatch', { from: '2026-07-01', to: '2026-07-01' })
    expect(r.ok).toBe(true)
    expect(r.billDays).toEqual([])
  })

  it('getBillMatch：窗内已付单超读取上限 → approx:true', async () => {
    control.seed(
      'orders',
      Array.from({ length: RECON_WINDOW_MAX + 1 }, (_, i) => ({ _id: 'c' + i, id: 'c' + i, _openid: 'x', status: 'paid', amount: 1, paidAt: d1 + i, createdAt: 1, items: [] }))
    )
    const r = await post('getBillMatch', { from: '2026-07-01', to: '2026-07-01' })
    expect(r.approx).toBe(true)
  })
})

describe('每日对账 timer 与账单落库', () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const PRIV = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  const NOW = Date.parse('2026-07-16T12:00:00+08:00')
  const DATE = '2026-07-15'
  const csv = (rows: string[]) =>
    ['交易时间,公众账号ID,商户号,微信订单号,商户订单号,交易状态,订单金额,退款金额', ...rows, '总交易单数,交易总金额,退款总金额', `\`${rows.length},\`0.00,\`0.00`].join('\n')
  const billFetch = (body: string) => async (url: string) =>
    url.includes('/v3/bill/tradebill')
      ? { status: 200, text: async () => JSON.stringify({ download_url: 'https://api.mch.weixin.qq.com/v3/billdownload/file?token=t' }) }
      : { status: 200, text: async () => body }
  const seedCreds = () => {
    control.seed(COLLECTIONS.secureConfig, [{ _id: 'wxpay', mchSerial: 'TESTSERIAL123', mchPrivateKey: PRIV }])
    control.seed(COLLECTIONS.config, [{ _id: 'pay', subMchId: '1113881793' }])
  }
  const paidAt = NOW - 86400_000

  beforeEach(() => {
    vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => ({ errcode: 0 }), text: async () => '{}' }))
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('我方订单读失败 → 单条 ORDERS_READ_FAIL 告警，不写 BILL_WX_ONLY 假异常', async () => {
    seedCreds()
    control.seed('orders', [{ _id: 'm1', id: 'm1', _openid: 'x', status: 'paid', amount: 100, transactionId: 'tx-1', paidAt, items: [] }])
    failReads((a) => a.coll === 'orders' && !!a.filter)
    const r: any = await runBillReconcile(db, {
      now: NOW,
      fetchImpl: billFetch(csv(['`2026-07-15 10:00:00,`wxapp,`1113881793,`tx-1,`m1,`SUCCESS,`100.00,`0.00'])),
    })
    expect(r.error).toBe('ORDERS_READ_FAIL')
    expect(alerted('BILL_WX_ONLY')).toBe(false)
    expect(alerted('BILL_RECON_ORDERS_READ_FAIL')).toBe(true)
  })

  it('默认 cap 是对账窗读取上限：宽窗里的单比它多一条即 truncated', async () => {
    seedCreds()
    control.seed(
      'orders',
      Array.from({ length: RECON_WINDOW_MAX + 1 }, (_, i) => ({ _id: 'c' + i, id: 'c' + i, _openid: 'x', status: 'paid', amount: 1, transactionId: 'tc' + i, paidAt: paidAt + i, items: [] }))
    )
    const r: any = await runBillReconcile(db, { now: NOW, fetchImpl: billFetch(csv(['`2026-07-15 10:00:00,`wxapp,`1113881793,`tx-g,`g,`SUCCESS,`5.00,`0.00'])) })
    expect(r.truncated).toBe(true)
  })

  it('同日先付后部分退：REFUND 行不覆盖 SUCCESS 行，getBillMatch 不误报「我方有微信无」', async () => {
    seedCreds()
    control.seed('orders', [
      { _id: 'm1', id: 'm1', _openid: 'x', status: 'paid', amount: 100, transactionId: 'tx-1', paidAt, items: [] },
      { _id: 'm2', id: 'm2', _openid: 'x', status: 'paid', amount: 50, transactionId: 'tx-2', paidAt, items: [] },
    ])
    await runBillReconcile(db, {
      now: NOW,
      fetchImpl: billFetch(
        csv([
          '`2026-07-15 10:00:00,`wxapp,`1113881793,`tx-1,`m1,`SUCCESS,`100.00,`0.00',
          '`2026-07-15 10:30:00,`wxapp,`1113881793,`tx-2,`m2,`SUCCESS,`50.00,`0.00',
          '`2026-07-15 11:00:00,`wxapp,`1113881793,`tx-1,`m1,`REFUND,`100.00,`30.00',
        ])
      ),
    })
    expect(control.dump(COLLECTIONS.wxBills).find((b: any) => b._id === `${DATE}:tx-1`).tradeState).toBe('SUCCESS')
    const r = await post('getBillMatch', { from: DATE, to: DATE })
    expect(r.summary).toEqual({ matched: 2, wxOnly: 0, oursOnly: 0, amountMismatch: 0 })
  })
})

describe('支付回调：读失败不 ACK（留给微信重推自愈），先告警再抛', () => {
  const payEvent = { out_trade_no: 'o1', trade_state: 'SUCCESS', transaction_id: 'txn-1', amount: { payer_total: 10000, total: 10000 } }
  const pending = () => control.seed('orders', [{ _id: 'o1', amount: 100, status: 'pending', reserved: [], createdAt: 1 }])
  const failNthOrderDocGet = (n: number) => {
    let seen = 0
    failReads((a) => a.coll === 'orders' && a.id === 'o1' && ++seen === n)
  }

  it('初读瞬时失败 → 抛（不 ACK）+ ORDER_READ_FAIL，不报 UNKNOWN_ORDER', async () => {
    pending()
    failNthOrderDocGet(1)
    await expect(payCallback(payEvent)).rejects.toThrow()
    expect(control.dump('orders')[0].status).toBe('pending')
    expect(alerted('UNKNOWN_ORDER')).toBe(false)
    expect(alerted('ORDER_READ_FAIL')).toBe(true)
  })

  it('状态流转内部读失败 → 抛（不 ACK）+ REREAD_FAIL，不报 UNKNOWN_ORDER', async () => {
    pending()
    failNthOrderDocGet(2)
    await expect(payCallback(payEvent)).rejects.toThrow()
    expect(alerted('UNKNOWN_ORDER')).toBe(false)
    expect(alerted('REREAD_FAIL')).toBe(true)
  })

  it('关单竞态重读失败 → 抛（不 ACK）+ REREAD_FAIL', async () => {
    pending()
    let closed = false
    control.setBeforeUpdate(async ({ coll }: any) => {
      if (coll !== 'orders' || closed) return
      closed = true // 并发关单抢在 CAS 前
      await getDb().collection('orders').doc('o1').update({ data: { status: 'closed' } })
    })
    failNthOrderDocGet(3)
    await expect(payCallback(payEvent)).rejects.toThrow()
    expect(alerted('REREAD_FAIL')).toBe(true)
  })

  it('真无此单 → UNKNOWN_ORDER + ACK（不变）', async () => {
    expect(await payCallback(payEvent)).toEqual({ errcode: 0, errmsg: 'OK' })
    expect(alerted('UNKNOWN_ORDER')).toBe(true)
  })
})

describe('退款回调：反查读失败不 ACK；抢占后读订单失败不静默跳过回补', () => {
  const asId = 'o1__p1__红'
  const seedAS = (over: Record<string, unknown> = {}) =>
    control.seed('afterSales', [
      { _id: asId, orderId: 'o1', lineId: 'p1__红', productId: 'p1', spec: '红', qty: 1, refundAmount: 178, status: 'approved', outRefundNo: refundNoFor(asId), ...over },
    ])
  const ev = (outRefundNo: string) => ({ out_refund_no: outRefundNo, out_trade_no: 'o1', refund_status: 'SUCCESS', transaction_id: 'wx-rf', amount: { refund: 17800 } })

  it('按单号字段反查读失败 → 抛（不 ACK）+ 告警，不报 UNKNOWN_AFTERSALE', async () => {
    seedOrder()
    seedAS()
    failReads(afterSalesScan)
    await expect(refundCallback(ev(refundNoFor(asId)))).rejects.toThrow()
    expect(control.dump('afterSales')[0].status).toBe('approved')
    expect(alerted('UNKNOWN_AFTERSALE')).toBe(false)
    expect(alerted('AFTERSALE_READ_FAIL')).toBe(true)
  })

  it('老单按 _id 回退读瞬时失败 → 抛（不 ACK）+ 告警', async () => {
    seedOrder()
    seedAS({ _id: 'o1__p1', lineId: 'p1', outRefundNo: undefined })
    failReads((a) => a.coll === 'afterSales' && a.id === 'o1__p1')
    await expect(refundCallback(ev('o1__p1'))).rejects.toThrow()
    expect(alerted('UNKNOWN_AFTERSALE')).toBe(false)
    expect(alerted('AFTERSALE_READ_FAIL')).toBe(true)
  })

  it('已置 refunded 后读订单失败 → 告警回补被跳过（重推补不回来，只能人工）', async () => {
    seedOrder()
    seedAS()
    control.seed('inventory', [{ _id: 'p1__红', productId: 'p1', spec: '红', stock: 0 }])
    failReads((a) => a.coll === 'orders')
    await refundCallback(ev(refundNoFor(asId)))
    expect(control.dump('afterSales')[0].status).toBe('refunded')
    expect(alerted('RESTOCK_SKIPPED_ORDER_READ_FAIL')).toBe(true)
  })
})

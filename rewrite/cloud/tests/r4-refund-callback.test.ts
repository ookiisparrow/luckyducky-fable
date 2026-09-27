// #400-1 / #400-20：退款回调的库存回补——只还下单时真扣过的件、同一 SKU 已还过的不再还；并发重推只翻一次、只还一次。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { control } from 'wx-server-sdk'
import { COLLECTIONS, toFen } from '@ldrw/shared'
import { main as adminApi } from '../src/functions/adminApi/index'
import { main as refundCallback } from '../src/functions/callbacks/refundCallback'
import { sha } from '../src/functions/adminApi/lib'

const post = (action: string, data: Record<string, unknown> = {}) =>
  adminApi({
    httpMethod: 'POST',
    headers: { 'x-forwarded-for': '1.1.1.1' },
    body: JSON.stringify({ action, key: 'super-secret-key', data }),
  }).then((r: any) => ({ status: r.statusCode, ...JSON.parse(r.body) }))

const LINE = { productId: 'p1', lineId: 'p1__红', spec: '红', name: '鸭', price: 50, qty: 2, refundable: true }
const seedOrder = (over: Record<string, unknown> = {}) =>
  control.seed(COLLECTIONS.orders, [
    {
      _id: 'o1',
      id: 'o1',
      _openid: 'oBUYER',
      status: 'paid',
      amount: 100,
      goods: 100,
      createdAt: 1000,
      items: [LINE],
      reserved: [{ productId: 'p1', spec: '红', qty: 2 }],
      ...over,
    },
  ])
const seedAS = (over: Record<string, unknown> = {}) =>
  control.seed(COLLECTIONS.afterSales, [
    {
      _id: 'o1__p1__红',
      orderId: 'o1',
      _openid: 'oBUYER',
      lineId: 'p1__红',
      productId: 'p1',
      spec: '红',
      qty: 1,
      refundAmount: 50,
      outRefundNo: 'rf-piece',
      status: 'approved',
      ...over,
    },
  ])
const stock = () => control.dump(COLLECTIONS.inventory).find((x: any) => x._id === 'p1__红').stock
const asDoc = (id: string) => control.dump(COLLECTIONS.afterSales).find((a: any) => a._id === id)
const success = (a: any) =>
  refundCallback({
    out_refund_no: a.outRefundNo,
    out_trade_no: a.orderId,
    refund_status: 'SUCCESS',
    transaction_id: 'wx-' + a._id,
    amount: { refund: toFen(a.refundAmount) },
  })
const alerted = (code: string) => control.dump(COLLECTIONS.anomalies).some((a: any) => a.code === code)

beforeEach(() => {
  control.reset()
  control.setOpenId('')
  control.seed(COLLECTIONS.adminConfig, [{ _id: 'auth', keyHash: sha('super-secret-key'), role: 'superadmin' }])
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('退款回补不超过下单时的预留量（#400-1）', () => {
  it('一行 2 件：先按件退 1 件，再越规退整行——前后共只还 2 件（下单扣了几件就还几件）', async () => {
    seedOrder({ items: [{ ...LINE, enteredQty: 1 }] })
    seedAS()
    control.seed(COLLECTIONS.inventory, [{ _id: 'p1__红', productId: 'p1', spec: '红', stock: 10 }])
    await success(asDoc('o1__p1__红'))
    expect(stock()).toBe(11)

    control.seed(COLLECTIONS.config, [{ _id: 'pay', mode: 'real', refundFlowId: 'flow-refund' }])
    control.setCallFunctionResult({ result: { data: { status: 'PROCESSING' } } })
    const ovr = await post('overrideRefund', { orderId: 'o1', lineId: 'p1__红', reason: '客诉' })
    expect(ovr.ok).toBe(true)
    await success(asDoc(ovr.id))
    expect(asDoc(ovr.id).status).toBe('refunded')
    expect(stock()).toBe(12)
  })

  it('下单时不限量（没扣库存），后来改成限量：退款不往库存里加', async () => {
    seedOrder({ reserved: [] })
    seedAS()
    control.seed(COLLECTIONS.inventory, [{ _id: 'p1__红', productId: 'p1', spec: '红', stock: 5 }])
    await success(asDoc('o1__p1__红'))
    expect(asDoc('o1__p1__红').status).toBe('refunded')
    expect(stock()).toBe(5)
  })

  it('只按本 SKU 的预留封顶、只减本 SKU 已退掉的件（别的 SKU、没退成的售后都不算）', async () => {
    seedOrder({
      reserved: [
        { productId: 'p1', spec: '蓝', qty: 3 },
        { productId: 'p1', spec: '红', qty: 1 },
      ],
    })
    seedAS({ _id: 'o1__p1__蓝', lineId: 'p1__蓝', spec: '蓝', qty: 1, status: 'refunded', outRefundNo: 'rf-blue' })
    seedAS({ _id: 'o1__p1__红__ovr0', qty: 1, status: 'rejected', outRefundNo: 'rf-rej' })
    seedAS({ qty: 2 })
    control.seed(COLLECTIONS.inventory, [{ _id: 'p1__红', productId: 'p1', spec: '红', stock: 0 }])
    await success(asDoc('o1__p1__红'))
    expect(stock()).toBe(1)
  })

  it('读同单售后失败：判不了已还多少，宁可不还，并告警人工补', async () => {
    seedOrder()
    seedAS()
    control.seed(COLLECTIONS.inventory, [{ _id: 'p1__红', productId: 'p1', spec: '红', stock: 0 }])
    control.setBeforeGet(async (a: any) => {
      if (a.coll === COLLECTIONS.afterSales && a.filter && !('outRefundNo' in a.filter)) throw new Error('MOCK_READ_FAIL')
    })
    await success(asDoc('o1__p1__红'))
    expect(asDoc('o1__p1__红').status).toBe('refunded')
    expect(stock()).toBe(0)
    expect(alerted('RESTOCK_SKIPPED_AFTERSALE_READ_FAIL')).toBe(true)
  })
})

describe('并发重推退款成功通知（#400-20）', () => {
  it('两条同单号成功通知交错到达：售后单只翻一次、库存只还一次', async () => {
    seedOrder()
    seedAS({ qty: 2, refundAmount: 100 })
    control.seed(COLLECTIONS.inventory, [{ _id: 'p1__红', productId: 'p1', spec: '红', stock: 0 }])
    const a = asDoc('o1__p1__红')
    // 第一条通知已读到 approved、正要抢占时，第二条通知整条跑完
    let raced = false
    control.setBeforeUpdate(async (u: any) => {
      if (raced || u.coll !== COLLECTIONS.afterSales || u.data.status !== 'refunded') return
      raced = true
      await success(a)
    })
    await success(a)
    expect(raced).toBe(true)
    expect(asDoc('o1__p1__红').status).toBe('refunded')
    expect(stock()).toBe(2)
  })

  // 封顶靠「先抢占成 refunded、后读同单售后」：两张并发退款至少一张看得见对方。挂在 A 抢占前插入 B，
  // 读同单售后若被挪到抢占前（或与读订单并行提前），A、B 都看不见对方，会还 3 件。
  it('同一行两张不同售后（按件退 + 越规退）成功通知交错到达：共只还预留的 2 件', async () => {
    seedOrder()
    seedAS()
    seedAS({ _id: 'o1__p1__红__ovr0', qty: 2, outRefundNo: 'rf-ovr' })
    control.seed(COLLECTIONS.inventory, [{ _id: 'p1__红', productId: 'p1', spec: '红', stock: 0 }])
    const a = asDoc('o1__p1__红')
    const b = asDoc('o1__p1__红__ovr0')
    let raced = false
    control.setBeforeUpdate(async (u: any) => {
      if (raced || u.coll !== COLLECTIONS.afterSales || u.data.refundTransactionId !== 'wx-' + a._id) return
      raced = true
      await success(b)
    })
    await success(a)
    expect(raced).toBe(true)
    expect(asDoc(a._id).status).toBe('refunded')
    expect(asDoc(b._id).status).toBe('refunded')
    expect(stock()).toBe(2)
  })
})

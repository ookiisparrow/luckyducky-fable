// 变异分诊：adminApi/actions/orders.ts 存活变异的杀手测试（列表的权限/筛选/退款标记、发货入参、陈旧锁抢占的边界与互斥、
// 上传失败留痕、核销流水失败告警、批量发货的逐单覆盖与操作人、解除金额异常的前置闸）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { control } from 'wx-server-sdk'
import { COLLECTIONS } from '@ldrw/shared'
import { main as adminApi } from '../src/functions/adminApi/index'
import { sha } from '../src/functions/adminApi/lib'

const SUPER = 'super-secret-key'
const postAs = (key: string, action: string, data: Record<string, unknown> = {}) =>
  adminApi({
    httpMethod: 'POST',
    headers: { 'x-forwarded-for': '1.1.1.1' },
    body: JSON.stringify({ action, key, data }),
  }).then((r: any) => ({ status: r.statusCode, ...JSON.parse(r.body) }))
const post = (action: string, data: Record<string, unknown> = {}) => postAs(SUPER, action, data)

const LINE = { productId: 'p1', lineId: 'p1__红', spec: '红', name: '鸭', price: 50, qty: 2, refundable: true }
const order = (id: string, over: Record<string, unknown> = {}) => ({
  _id: id,
  id,
  _openid: 'oBUYER',
  status: 'paid',
  amount: 100,
  goods: 100,
  transactionId: 'tx-' + id,
  createdAt: 1000,
  items: [LINE],
  ...over,
})
const orderDoc = (id = 'o1') => control.dump(COLLECTIONS.orders).find((o: any) => o._id === id)
const anomaly = (code: string) => {
  const a = control.dump(COLLECTIONS.anomalies).find((x: any) => x.code === code)
  return a && { kind: a.kind, ctx: a.ctx }
}
const LOCK_STALE_MS = 5 * 60 * 1000

beforeEach(() => {
  control.reset()
  control.setOpenId('')
  control.seed(COLLECTIONS.adminConfig, [
    { _id: 'auth', keyHash: sha(SUPER), role: 'superadmin' },
    { _id: 'writer1', keyHash: sha('writer-key'), caps: ['admin:write'] },
    { _id: 'both1', keyHash: sha('both-key'), caps: ['refund:manage', 'admin:write'] },
    { _id: 'refmgr', keyHash: sha('refmgr-key'), caps: ['refund:manage'] },
  ])
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('listOrders', () => {
  it('只持 admin:write、或同时持 refund:manage 与 admin:write：都能不带单号浏览；只持 refund:manage 回 ORDER_NO_REQUIRED', async () => {
    control.seed(COLLECTIONS.orders, [order('o1')])
    expect((await postAs('writer-key', 'listOrders')).status).toBe(200)
    expect((await postAs('both-key', 'listOrders')).status).toBe(200)
    const r = await postAs('refmgr-key', 'listOrders')
    expect(r.status).toBe(403)
    expect(r.error).toBe('ORDER_NO_REQUIRED')
  })

  it('status=all 回全部；q 两头空格去掉后按单号精确查', async () => {
    control.seed(COLLECTIONS.orders, [order('o1'), order('o2', { status: 'shipped', createdAt: 2000 })])
    expect((await post('listOrders', { status: 'all' })).list.map((o: any) => o._id)).toEqual(['o2', 'o1'])
    expect((await post('listOrders', { q: '  o1  ' })).list.map((o: any) => o._id)).toEqual(['o1'])
  })

  it('订单只有 _id 没有 id 字段：在途售后照样把它标成 refundHold', async () => {
    control.seed(COLLECTIONS.orders, [order('o1', { id: undefined })])
    control.seed(COLLECTIONS.afterSales, [{ _id: 'as1', orderId: 'o1', lineId: 'p1__红', status: 'applied', qty: 1 }])
    expect((await post('listOrders')).list[0].refundHold).toBe(true)
  })
})

describe('shipOrder 入参与退款拦截', () => {
  it('缺单号、缺快递公司、缺运单号：BAD_ARGS', async () => {
    control.seed(COLLECTIONS.orders, [order('o1')])
    expect((await post('shipOrder', { company: 'SF', trackingNo: 'T' })).error).toBe('BAD_ARGS')
    expect((await post('shipOrder', { id: 'o1', trackingNo: 'T' })).error).toBe('BAD_ARGS')
    expect((await post('shipOrder', { id: 'o1', company: 'SF' })).error).toBe('BAD_ARGS')
    expect(orderDoc().status).toBe('paid')
  })

  it('支付异常单（带金额不符标记）：先按状态拒，回 BAD_STATUS 而不是 FEE_MISMATCH_HOLD', async () => {
    control.seed(COLLECTIONS.orders, [order('o1', { status: 'payment_exception', feeMismatch: true })])
    expect((await post('shipOrder', { id: 'o1', company: 'SF', trackingNo: 'T', ackRefundedQty: {} })).error).toBe(
      'BAD_STATUS:payment_exception'
    )
  })

  it('回传的已退件数不是对象（null、字符串）：按「没退过」核对，没退款的单照常发', async () => {
    control.seed(COLLECTIONS.orders, [order('o1'), order('o2')])
    expect((await post('shipOrder', { id: 'o1', company: 'SF', trackingNo: 'T', ackRefundedQty: null })).ok).toBe(true)
    expect((await post('shipOrder', { id: 'o2', company: 'SF', trackingNo: 'T', ackRefundedQty: '1' })).ok).toBe(true)
  })

  it('每行都退够件数：REFUND_HOLD，并回命中的行号', async () => {
    control.seed(COLLECTIONS.orders, [order('o1')])
    control.seed(COLLECTIONS.afterSales, [{ _id: 'as1', orderId: 'o1', lineId: 'p1__红', status: 'refunded', qty: 2 }])
    const r = await post('shipOrder', { id: 'o1', company: 'SF', trackingNo: 'T' })
    expect(r.error).toBe('REFUND_HOLD')
    expect(r.lines).toEqual(['p1__红'])
  })
})

describe('发货上传互斥闸的陈旧锁', () => {
  const T = 1_800_000_000_000
  const busyOrder = (lockAt: number, over: Record<string, unknown> = {}) =>
    control.seed(COLLECTIONS.orders, [order('o1', { status: 'shipped', shippedAt: 123, shipUploadLock: 'busy', shipUploadLockAt: lockAt, ...over })])

  it('锁没过期（持锁刚 1 秒）：SHIP_IN_PROGRESS，不抢', async () => {
    busyOrder(Date.now() - 1000)
    expect((await post('shipOrder', { id: 'o1', company: 'SF', trackingNo: 'T2' })).error).toBe('SHIP_IN_PROGRESS')
  })

  it('持锁恰好 5 分钟：还不算过期', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T)
    busyOrder(T - LOCK_STALE_MS)
    expect((await post('shipOrder', { id: 'o1', company: 'SF', trackingNo: 'T2' })).error).toBe('SHIP_IN_PROGRESS')
  })

  it('超过 5 分钟：抢占成功、保留原发货时间、上传期间锁仍被占住、告警带卡住时长', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T)
    busyOrder(T - LOCK_STALE_MS - 1)
    let concurrent: any = null
    control.setBeforeUpdate(async ({ coll, data }: any) => {
      if (coll !== COLLECTIONS.orders || data.shipUploadLock !== 'idle' || concurrent) return
      concurrent = 'pending'
      concurrent = await post('shipOrder', { id: 'o1', company: 'YT', trackingNo: 'T3' })
    })
    const r = await post('shipOrder', { id: 'o1', company: 'SF', trackingNo: 'T2' })
    expect(r.ok).toBe(true)
    expect(concurrent.error).toBe('SHIP_IN_PROGRESS')
    const o = orderDoc()
    expect(o.shippedAt).toBe(123)
    expect(o.shipping).toEqual({ company: 'SF', trackingNo: 'T2' })
    expect(o.shipUploadLock).toBe('idle')
    expect(anomaly('SHIP_LOCK_STALE_PREEMPTED')).toEqual({
      kind: 'invariant-violation',
      ctx: { fn: 'shipOne', id: 'o1', staleForMs: String(LOCK_STALE_MS + 1) },
    })
  })
})

describe('发货留痕', () => {
  it('没有交易单号、微信上传失败：记下失败原因、释放锁、告警带订单号和原因', async () => {
    control.seed(COLLECTIONS.orders, [order('o1', { transactionId: '' })])
    expect((await post('shipOrder', { id: 'o1', company: 'SF', trackingNo: 'T', ackRefundedQty: {} })).wxShip).toBe(false)
    const o = orderDoc()
    expect(o).toMatchObject({ status: 'shipped', wxShipUploaded: false, wxShipError: 'NO_TRANSACTION_ID', shipUploadLock: 'idle' })
    expect(anomaly('WX_SHIP_UPLOAD_FAIL')).toEqual({ kind: 'flow-failure', ctx: { fn: 'shipOrder', orderId: 'o1', error: 'NO_TRANSACTION_ID' } })
  })

  it('核销流水写失败：发货照常成功，另告警 SCM_LEDGER_FAIL', async () => {
    control.seed(COLLECTIONS.orders, [order('o1')])
    control.setBeforeAdd(async ({ coll }: any) => {
      if (coll === COLLECTIONS.stockLedger) throw new Error('MOCK_ADD_FAIL')
    })
    expect((await post('shipOrder', { id: 'o1', company: 'SF', trackingNo: 'T', ackRefundedQty: {} })).ok).toBe(true)
    expect(anomaly('SCM_LEDGER_FAIL')).toEqual({ kind: 'invariant-violation', ctx: { fn: 'shipOrder', id: 'o1' } })
  })

  it('上传成功：不告警；核销流水记的是认证账号本人', async () => {
    control.seed(COLLECTIONS.orders, [order('o1')])
    expect((await postAs('writer-key', 'shipOrder', { id: 'o1', company: 'SF', trackingNo: 'T', ackRefundedQty: {} })).ok).toBe(true)
    expect(control.dump(COLLECTIONS.stockLedger).map((l: any) => l.operator)).toEqual(['writer1'])
    expect(orderDoc().wxShipUploaded).toBe(true)
    expect(anomaly('WX_SHIP_UPLOAD_FAIL')).toBeUndefined()
    expect(anomaly('SCM_LEDGER_FAIL')).toBeUndefined()
    expect(control.openapiCalls()[0].payer).toEqual({ openid: 'oBUYER' })
  })

  it('脏条目（缺商品号、件数不是正整数）不记流水，也不连累好条目的流水', async () => {
    const dirty = [LINE, { lineId: 'x__', spec: '', qty: 1 }, { ...LINE, productId: 'p3', lineId: 'p3__', qty: 1.5 }]
    control.seed(COLLECTIONS.orders, [order('o1', { items: dirty })])
    expect((await post('shipOrder', { id: 'o1', company: 'SF', trackingNo: 'T', ackRefundedQty: {} })).ok).toBe(true)
    expect(control.dump(COLLECTIONS.stockLedger).map((l: any) => [l.itemKey, l.delta])).toEqual([['fg:p1__红', -2]])
    expect(anomaly('SCM_LEDGER_FAIL')).toBeUndefined()
  })

  it('已发货的单改单号：不补记核销流水', async () => {
    control.seed(COLLECTIONS.orders, [order('o1', { status: 'shipped', shippedAt: 123 })])
    expect((await post('shipOrder', { id: 'o1', company: 'SF', trackingNo: 'T2' })).ok).toBe(true)
    expect(control.dump(COLLECTIONS.stockLedger)).toEqual([])
  })

  it('旧单没有条目：照常发货，不记流水也不报 SCM_LEDGER_FAIL', async () => {
    control.seed(COLLECTIONS.orders, [order('o1', { items: [] })])
    expect((await post('shipOrder', { id: 'o1', company: 'SF', trackingNo: 'T', ackRefundedQty: {} })).ok).toBe(true)
    expect(control.dump(COLLECTIONS.stockLedger)).toEqual([])
    expect(anomaly('SCM_LEDGER_FAIL')).toBeUndefined()
  })

  it('快递公司截 30 字、运单号截 40 字（去掉两头空格后），落库和上传微信都用截后的值', async () => {
    control.seed(COLLECTIONS.orders, [order('o1')])
    const company = ' ' + '顺'.repeat(35) + ' '
    const trackingNo = ' ' + '9'.repeat(45) + ' '
    expect((await post('shipOrder', { id: 'o1', company, trackingNo, ackRefundedQty: {} })).ok).toBe(true)
    expect(orderDoc().shipping).toEqual({ company: '顺'.repeat(30), trackingNo: '9'.repeat(40) })
    expect(control.openapiCalls()[0].shippingList[0].trackingNo).toBe('9'.repeat(40))
  })
})

describe('shipOrders 批量发货', () => {
  it('没有条目：400 BAD_ARGS；101 条：TOO_MANY；恰好 100 条放行（逐单报结果）', async () => {
    expect(await post('shipOrders', {})).toMatchObject({ status: 400, error: 'BAD_ARGS' })
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ id: 'x' + i }))
    expect((await post('shipOrders', { items: many(101) })).error).toBe('TOO_MANY')
    const r = await post('shipOrders', { items: many(100) })
    expect(r).toMatchObject({ status: 200, ok: true, okCount: 0, failCount: 100 })
  })

  it('整批公司兜底、单条公司覆盖、单条运单号、单条已退件数核对、操作人都按条目走', async () => {
    control.seed(COLLECTIONS.orders, [order('o1'), order('o2', { items: [{ ...LINE, lineId: 'p1__蓝', spec: '蓝' }] })])
    control.seed(COLLECTIONS.afterSales, [{ _id: 'as1', orderId: 'o1', lineId: 'p1__红', status: 'refunded', qty: 1 }])
    const r = await postAs('writer-key', 'shipOrders', {
      company: 'SF',
      items: [
        { id: 'o1', trackingNo: 'T1', ackRefundedQty: { 'p1__红': 1 } },
        { id: 'o2', company: 'YT', trackingNo: 'T2', ackRefundedQty: {} },
      ],
    })
    expect(r.results.map((x: any) => [x.id, x.ok])).toEqual([
      ['o1', true],
      ['o2', true],
    ])
    expect(orderDoc('o1').shipping).toEqual({ company: 'SF', trackingNo: 'T1' })
    expect(orderDoc('o2').shipping).toEqual({ company: 'YT', trackingNo: 'T2' })
    expect(control.dump(COLLECTIONS.stockLedger).map((l: any) => l.operator)).toEqual(['writer1', 'writer1'])
  })

  it('条目缺单号、整批和条目都没给公司：该条 BAD_ARGS，单号回空串', async () => {
    control.seed(COLLECTIONS.orders, [order('o1')])
    const r = await post('shipOrders', { items: [{ trackingNo: 'T' }, { id: 'o1', trackingNo: 'T' }] })
    expect(r.results).toEqual([
      { id: '', ok: false, error: 'BAD_ARGS' },
      { id: 'o1', ok: false, error: 'BAD_ARGS' },
    ])
  })
})

describe('clearFeeMismatch', () => {
  it('缺单号：BAD_ARGS；无此单：NO_ORDER', async () => {
    expect((await post('clearFeeMismatch', {})).error).toBe('BAD_ARGS')
    expect((await post('clearFeeMismatch', { id: 'ghost' })).error).toBe('NO_ORDER')
  })
})

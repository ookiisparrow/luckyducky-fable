// adminApi 钱链读路径行为锁：订单详情激活态、退款前置闸先后、退款详情、对账区间汇总、审计日志 from 收口。
import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as adminApi } from '../src/functions/adminApi/index'
import { sha } from '../src/functions/adminApi/lib'

const post = (action: string, data: Record<string, unknown> = {}) =>
  adminApi({
    httpMethod: 'POST',
    headers: { 'x-forwarded-for': '1.1.1.1' },
    body: JSON.stringify({ action, key: 'super-secret-key', data }),
  }).then((r: any) => ({ status: r.statusCode, ...JSON.parse(r.body) }))

const ITEM = { productId: 'p1', lineId: 'p1__红', spec: '红', name: '鸭', price: 198, qty: 2, refundable: true }
const seedOrder = (over: Record<string, unknown> = {}) =>
  control.seed('orders', [
    { _id: 'o1', id: 'o1', _openid: 'oBUYER', status: 'paid', amount: 178, goods: 198, createdAt: 1000, items: [ITEM], ...over },
  ])
const seedAS = (over: Record<string, unknown> = {}) =>
  control.seed('afterSales', [
    { _id: 'as1', orderId: 'o1', _openid: 'oBUYER', lineId: 'p1__红', productId: 'p1', qty: 2, refundAmount: 178, status: 'applied', ...over },
  ])
const seedFlow = () => control.seed('config', [{ _id: 'pay', mode: 'real', refundFlowId: 'flow-refund' }])

beforeEach(() => {
  control.reset()
  control.setOpenId('')
  control.seed('adminConfig', [{ _id: 'auth', keyHash: sha('super-secret-key'), role: 'superadmin' }])
})

describe('getOrderDetail：逐商品激活态', () => {
  it('按商品去重、键序＝首次出现顺序；空 productId 跳过；无 courseId 回退 course-<pid>', async () => {
    control.seed('products', [{ _id: 'p1', id: 'p1', courseId: 'c1' }])
    control.seed('activations', [{ _id: 'act1', _openid: 'oBUYER', courseId: 'c1', qrcodeId: 'q1', enteredAt: 5 }])
    seedOrder({ items: [{ productId: 'p2' }, { productId: 'p1', spec: 'a' }, { productId: 'p1', spec: 'b' }, { productId: '' }, {}] })
    const r = await post('getOrderDetail', { id: 'o1' })
    expect(r.ok).toBe(true)
    expect(Object.keys(r.activations)).toEqual(['p2', 'p1'])
    expect(r.activations.p1).toEqual({ courseId: 'c1', activated: true, entered: true, code: 'q1', enteredAt: 5 })
    expect(r.activations.p2).toEqual({ courseId: 'course-p2', activated: false, entered: false, code: '', enteredAt: null })
  })

  it('缺 id → BAD_ARGS；无此单 → NO_ORDER；商品读失败 → 500（不回退默认课程）', async () => {
    expect((await post('getOrderDetail', {})).error).toBe('BAD_ARGS')
    expect((await post('getOrderDetail', { id: 'ghost' })).error).toBe('NO_ORDER')
    seedOrder()
    control.setBeforeGet(async (a: any) => {
      if (a.coll === 'products') throw new Error('MOCK_READ_FAIL')
    })
    expect((await post('getOrderDetail', { id: 'o1' })).status).toBe(500)
  })
})

describe('overrideRefund / approveRefund 前置闸先后', () => {
  it('overrideRefund：未配退款流先于无此单；配了流再判 NO_ORDER', async () => {
    expect((await post('overrideRefund', { orderId: 'ghost', lineId: 'p1__红', reason: 'x' })).error).toBe('REFUND_FLOW_NOT_CONFIGURED')
    seedFlow()
    expect((await post('overrideRefund', { orderId: 'ghost', lineId: 'p1__红', reason: 'x' })).error).toBe('NO_ORDER')
    expect(control.callFunctionCalls()).toEqual([])
  })

  it('approveRefund：NO_RECORD → 状态闸 → 退款流 → NO_ORDER', async () => {
    expect((await post('approveRefund', { id: 'as1' })).error).toBe('NO_RECORD')
    seedAS({ status: 'approved' })
    expect((await post('approveRefund', { id: 'as1' })).error).toContain('BAD_STATUS')
    seedAS({ _id: 'as2' })
    expect((await post('approveRefund', { id: 'as2' })).error).toBe('REFUND_FLOW_NOT_CONFIGURED')
    seedFlow()
    expect((await post('approveRefund', { id: 'as2' })).error).toBe('NO_ORDER')
    expect(control.dump('afterSales')[1].status).toBe('applied')
    expect(control.callFunctionCalls()).toEqual([])
  })
})

describe('getRefundDetail', () => {
  it('回激活态 + 本单此行可退性；订单缺失＝lineFound:false、不拦', async () => {
    control.seed('products', [{ _id: 'p1', id: 'p1', courseId: 'c1' }])
    seedOrder({ items: [{ ...ITEM, enteredQty: 1 }] })
    seedAS()
    const r = await post('getRefundDetail', { id: 'as1' })
    expect(r).toEqual({
      status: 200,
      ok: true,
      activation: { courseId: 'c1', activated: false, entered: false, code: '', enteredAt: null },
      lineRefundable: true,
      refundableQty: 1,
      lineFound: true,
    })
    seedAS({ _id: 'as2', orderId: 'ghost' })
    const g = await post('getRefundDetail', { id: 'as2' })
    expect([g.lineFound, g.lineRefundable, g.refundableQty]).toEqual([false, true, null])
  })

  it('无此售后单 → NO_RECORD；激活态读失败 → 500', async () => {
    expect((await post('getRefundDetail', { id: 'as1' })).error).toBe('NO_RECORD')
    seedOrder()
    seedAS()
    control.setBeforeGet(async (a: any) => {
      if (a.coll === 'activations') throw new Error('MOCK_READ_FAIL')
    })
    expect((await post('getRefundDetail', { id: 'as1' })).status).toBe(500)
  })
})

describe('getReconciliation 区间汇总', () => {
  it('跨日分桶后汇总收入/退款/净额/笔数（分累加再回元）', async () => {
    const d1 = Date.parse('2026-07-01T04:00:00Z')
    const d2 = Date.parse('2026-07-02T04:00:00Z')
    control.seed('orders', [
      { _id: 'r1', id: 'r1', _openid: 'x', status: 'paid', amount: 0.1, paidAt: d1, createdAt: d1, items: [] },
      { _id: 'r2', id: 'r2', _openid: 'x', status: 'done', amount: 0.2, paidAt: d2, createdAt: d2, items: [] },
      { _id: 'r3', id: 'r3', _openid: 'x', status: 'shipped', amount: 19.9, paidAt: d2, createdAt: d2, items: [] },
    ])
    control.seed('afterSales', [{ _id: 'as1', orderId: 'r1', status: 'refunded', refundAmount: 0.05, refundedAt: d2 }])
    const r = await post('getReconciliation', { from: '2026-07-01', to: '2026-07-02' })
    expect(r.summary).toEqual({ income: 20.2, refund: 0.05, net: 20.15, orders: 3, refunds: 1 })
    expect(r.daily.map((b: any) => [b.day, b.orders, b.refunds])).toEqual([
      ['2026-07-01', 1, 0],
      ['2026-07-02', 2, 1],
    ])
  })
})

describe('listAudit：from 下界收口与 actionPrefix 页内过滤', () => {
  const rows = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ _id: 'r' + i, action: i % 2 ? 'shipOrder' : 'saveDraft', operator: 'x', ip: '', ok: true, summary: {}, ts: 1000 * (n - i) }))

  it('本页没触到 from：hasMore / nextCursor 原样透传', async () => {
    control.seed('auditLog', rows(5))
    const r = await post('listAudit', { from: 1000, limit: 2 })
    expect(r.entries.map((e: any) => e.ts)).toEqual([5000, 4000])
    expect(r.hasMore).toBe(true)
    expect(r.nextCursor).not.toBe(null)
  })

  it('本页触到 from：砍掉 hasMore / nextCursor', async () => {
    control.seed('auditLog', rows(5))
    const r = await post('listAudit', { from: 4500, limit: 2 })
    expect(r.entries.map((e: any) => e.ts)).toEqual([5000])
    expect([r.hasMore, r.nextCursor]).toEqual([false, null])
  })

  it('actionPrefix 在 hasMore 判定之后：本页无匹配也可能 hasMore 仍真', async () => {
    control.seed('auditLog', rows(5))
    const r = await post('listAudit', { actionPrefix: 'nope', limit: 2 })
    expect(r.entries).toEqual([])
    expect(r.hasMore).toBe(true)
    const f = await post('listAudit', { actionPrefix: 'ship', from: 3500, limit: 2 })
    expect(f.entries.map((e: any) => e.ts)).toEqual([4000])
    expect(f.hasMore).toBe(true)
  })
})

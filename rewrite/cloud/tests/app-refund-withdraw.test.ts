// 顾客撤销售后申请（withdrawRefund）+ 撤销后重新申请（applyRefund 复用同 _id）。
// 规则：只有「申请中」且从没被批准过的售后能撤；撤了不占退款额度；同一行可再申请，金额按当时重算、退款单号不变。
import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as app } from '../src/functions/app/index'
import { main as adminApi } from '../src/functions/adminApi/index'
import { sha } from '../src/functions/adminApi/lib'
import { refundNoFor } from '../src/kit'

const call = (action: string, data: Record<string, unknown> = {}) => app({ action, data }) as Promise<any>
const post = (action: string, data: Record<string, unknown> = {}) =>
  adminApi({
    httpMethod: 'POST',
    headers: { 'x-forwarded-for': '1.1.1.1' },
    body: JSON.stringify({ action, key: 'super-secret-key', data }),
  }).then((r: any) => ({ status: r.statusCode, ...JSON.parse(r.body) }))
const store = (coll: string): any[] => (globalThis as any).__cloudMock.store[coll]
const asDocs = () => control.dump('afterSales') as any[]

const LINE = 'p1__基础款'
const AS_ID = 'o1__' + LINE
// 实付 574 = 198×3 − 20
const seedOrder = (over: Record<string, unknown> = {}) =>
  control.seed('orders', [
    {
      _id: 'o1',
      id: 'o1',
      _openid: 'oME',
      status: 'paid',
      amount: 574,
      goods: 594,
      createdAt: 1000,
      address: { name: '张三', phone: '138', region: 'x', detail: 'y' },
      items: [{ productId: 'p1', lineId: LINE, spec: '基础款', name: '小鸭', price: 198, qty: 3, enteredQty: 0, refundable: true }],
      ...over,
    },
  ])
const seedAS = (over: Record<string, unknown> = {}) =>
  control.seed('afterSales', [
    { _id: AS_ID, orderId: 'o1', _openid: 'oME', lineId: LINE, productId: 'p1', spec: '基础款', qty: 3, refundAmount: 574, status: 'applied', appliedAt: 2000, ...over },
  ])

beforeEach(() => {
  control.reset()
  control.setOpenId('oME')
  control.seed('adminConfig', [{ _id: 'auth', keyHash: sha('super-secret-key'), role: 'superadmin' }])
})

describe('withdrawRefund 顾客撤销', () => {
  it('大白话：本人撤销申请中的售后——变「已撤销」、记撤销时间，记录还在', async () => {
    seedOrder()
    seedAS()
    const r = await call('withdrawRefund', { orderId: 'o1', lineId: LINE })
    expect(r.ok).toBe(true)
    expect(r.afterSale.status).toBe('withdrawn')
    expect(asDocs()).toHaveLength(1)
    expect(asDocs()[0].status).toBe('withdrawn')
    expect(typeof asDocs()[0].withdrawnAt).toBe('number')
  })

  it('大白话：别人的售后、不存在的售后一律「找不到」；缺参数拒', async () => {
    seedOrder()
    seedAS()
    control.setOpenId('oOTHER')
    expect((await call('withdrawRefund', { orderId: 'o1', lineId: LINE })).error).toBe('NOT_FOUND')
    control.setOpenId('oME')
    expect((await call('withdrawRefund', { orderId: 'o1', lineId: 'nope' })).error).toBe('NOT_FOUND')
    expect((await call('withdrawRefund', { orderId: 'o1' })).error).toBe('BAD_ARGS')
    expect(asDocs()[0].status).toBe('applied')
  })

  it('大白话：已同意/已退款/已拒绝/已撤销的不能撤，回对应状态码，状态不动', async () => {
    for (const status of ['approved', 'refunded', 'rejected', 'withdrawn']) {
      control.reset()
      control.setOpenId('oME')
      seedOrder()
      seedAS({ status })
      expect((await call('withdrawRefund', { orderId: 'o1', lineId: LINE })).error).toBe('BAD_STATUS:' + status)
      expect(asDocs()[0].status).toBe(status)
    }
  })

  it('大白话：商家批过、退款通道没受理又回到申请中的单不能撤（微信那边可能已真退了，撤了再申请会复用同一个退款单号）', async () => {
    seedOrder()
    seedAS({ approvedAt: 3000 })
    expect((await call('withdrawRefund', { orderId: 'o1', lineId: LINE })).error).toBe('BAD_STATUS:approved')
    expect(asDocs()[0].status).toBe('applied')
  })

  it('大白话：撤销那一刻商家刚点了同意——撤销落空，回「已同意」，单子保持已同意', async () => {
    seedOrder()
    seedAS()
    control.setBeforeUpdate(async ({ coll }: any) => {
      if (coll === 'afterSales') store('afterSales')[0].status = 'approved'
    })
    expect((await call('withdrawRefund', { orderId: 'o1', lineId: LINE })).error).toBe('BAD_STATUS:approved')
    expect(asDocs()[0].status).toBe('approved')
    expect(asDocs()[0].withdrawnAt).toBeUndefined()
  })

  it('大白话：顾客撤销和商家同意同时发生——只有一边生效', async () => {
    seedOrder()
    seedAS()
    control.seed('config', [{ _id: 'pay', mode: 'real', refundFlowId: 'flow-refund' }])
    control.setCallFunctionResult({ result: { data: { status: 'PROCESSING', refund_id: 'r1' } } })
    const [w, a] = await Promise.all([call('withdrawRefund', { orderId: 'o1', lineId: LINE }), post('approveRefund', { id: AS_ID })])
    expect([w.ok === true, a.ok === true].filter(Boolean)).toHaveLength(1)
    expect(asDocs()[0].status).toBe(w.ok ? 'withdrawn' : 'approved')
    if (w.ok) expect(control.callFunctionCalls()).toHaveLength(0) // 撤销赢了：没发起退款
  })

  it('大白话：一分钟内第 21 次撤销被限速', async () => {
    let last: any
    for (let i = 0; i < 21; i++) last = await call('withdrawRefund', { orderId: 'ghost', lineId: 'x' })
    expect(last.error).toBe('RATE_LIMITED')
  })
})

describe('已撤销对后台的影响', () => {
  it('大白话：撤销后不挡发货；后台售后计数里单独算「已撤销」，不算待审核', async () => {
    seedOrder()
    seedAS({ status: 'withdrawn', withdrawnAt: 2500 })
    const counts = await post('refundCounts')
    expect(counts.counts).toMatchObject({ all: 1, applied: 0, withdrawn: 1 })
    expect((await post('shipOrder', { id: 'o1', company: '顺丰', trackingNo: 'SF1' })).ok).toBe(true)
  })
})

describe('撤销后重新申请（applyRefund 复用同一张售后单）', () => {
  it('大白话：撤了能再申请——同一张单回到申请中，金额按现在重算，退款单号不变', async () => {
    seedOrder()
    const first = await call('applyRefund', { orderId: 'o1', lineId: LINE, reason: '少件' })
    expect(first.ok).toBe(true)
    expect((await call('withdrawRefund', { orderId: 'o1', lineId: LINE })).ok).toBe(true)
    // 撤销期间又进了 1 件课：重申只退剩余 2 件
    store('orders')[0].items[0].enteredQty = 1
    const again = await call('applyRefund', { orderId: 'o1', lineId: LINE, reason: '做工问题' })
    expect(again.ok).toBe(true)
    expect(asDocs()).toHaveLength(1)
    const d = asDocs()[0]
    expect(d._id).toBe(AS_ID)
    expect(d.status).toBe('applied')
    expect(d.qty).toBe(2)
    expect(d.reason).toBe('做工问题')
    expect(d.refundAmount).toBeLessThan(first.afterSale.refundAmount)
    expect(d.refundAmount).toBe(again.afterSale.refundAmount)
    expect(d.outRefundNo).toBe(first.afterSale.outRefundNo)
    expect(d.outRefundNo).toBe(refundNoFor(AS_ID))
  })

  it('大白话：同时点两次重新申请——只成功一次', async () => {
    seedOrder()
    seedAS({ status: 'withdrawn', withdrawnAt: 2500 })
    const rs = await Promise.all([
      call('applyRefund', { orderId: 'o1', lineId: LINE }),
      call('applyRefund', { orderId: 'o1', lineId: LINE }),
    ])
    expect(rs.filter((r) => r.ok)).toHaveLength(1)
    expect(rs.find((r) => !r.ok).error).toBe('ALREADY_APPLIED')
    expect(asDocs()).toHaveLength(1)
    expect(asDocs()[0].status).toBe('applied')
  })

  it('大白话：这一行还有别的没撤的售后（如管理员越规退款单）——仍回「已申请过」', async () => {
    seedOrder()
    control.seed('afterSales', [
      { _id: AS_ID, orderId: 'o1', _openid: 'oME', lineId: LINE, productId: 'p1', refundAmount: 100, status: 'withdrawn', appliedAt: 1 },
      { _id: AS_ID + '__ovr0', orderId: 'o1', _openid: 'oME', lineId: LINE, productId: 'p1', refundAmount: 100, status: 'approved', appliedAt: 2 },
    ])
    expect((await call('applyRefund', { orderId: 'o1', lineId: LINE })).error).toBe('ALREADY_APPLIED')
    expect(asDocs().find((a) => a._id === AS_ID).status).toBe('withdrawn')
  })

  it('大白话：已撤销的不占退款额度——别的行照样能按全额分摊退', async () => {
    seedOrder({
      amount: 178,
      goods: 198,
      items: [
        { productId: 'p1', lineId: 'p1__红', spec: '红', name: '鸭', price: 99, qty: 1, refundable: true },
        { productId: 'p1', lineId: 'p1__蓝', spec: '蓝', name: '鸭', price: 99, qty: 1, refundable: true },
      ],
    })
    // 红行撤销单金额写成全额实付：若被算进已用额度，蓝行就「没有可退金额」了
    control.seed('afterSales', [{ _id: 'o1__p1__红', orderId: 'o1', _openid: 'oME', lineId: 'p1__红', productId: 'p1', refundAmount: 178, status: 'withdrawn', appliedAt: 1 }])
    const r = await call('applyRefund', { orderId: 'o1', lineId: 'p1__蓝' })
    expect(r.ok).toBe(true)
    expect(r.afterSale.refundAmount).toBe(89)
  })
})

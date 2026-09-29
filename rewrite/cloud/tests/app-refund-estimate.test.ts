// 退款试算 estimateRefund（老板 2026-09-29 拍板 4）：提交前显示「预计退款 ¥X」。
// 规则：与 applyRefund 同一套校验、同一份算额（quoteRefund 共用），只算不写——试算数必须等于真申请时算出的数。
import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { toFen } from '@ldrw/shared'
import { main as app } from '../src/functions/app/index'

const call = (action: string, data: Record<string, unknown> = {}) => app({ action, data }) as Promise<any>
const asDocs = () => (control.dump('afterSales') as any[]) || []

// 两行一单：商品 198×2 + 99×1 = 495，实付 475（券 20）——分摊不是整数比例，最能看出试算与实退是否同一算法
const LA = 'p1__红'
const LB = 'p2__蓝'
const seedOrder = (over: Record<string, unknown> = {}) =>
  control.seed('orders', [
    {
      _id: 'o1',
      id: 'o1',
      _openid: 'oME',
      status: 'paid',
      amount: 475,
      goods: 495,
      createdAt: 1000,
      address: { name: '张三', phone: '138', region: 'x', detail: 'y' },
      items: [
        { productId: 'p1', lineId: LA, spec: '红', name: '小鸭', price: 198, qty: 2, enteredQty: 0, refundable: true },
        { productId: 'p2', lineId: LB, spec: '蓝', name: '云朵鸭', price: 99, qty: 1, enteredQty: 0, refundable: true },
      ],
      ...over,
    },
  ])
const seedAS = (lineId: string, status: string, refundAmount: number) =>
  control.seed('afterSales', [
    { _id: 'o1__' + lineId, orderId: 'o1', _openid: 'oME', lineId, productId: lineId.split('__')[0], qty: 1, refundAmount, status, appliedAt: 1 },
  ])

beforeEach(() => {
  control.reset()
  control.setOpenId('oME')
})

describe('estimateRefund 试算＝实退', () => {
  it('大白话：多行分摊——每一行的试算数都等于真申请时算出的退款额（先退一行占了额度，第二行也对得上）', async () => {
    seedOrder()
    const ea = await call('estimateRefund', { orderId: 'o1', lineId: LA })
    expect(Object.keys(ea).sort()).toEqual(['ok', 'refundFen'])
    expect(Number.isInteger(ea.refundFen)).toBe(true) // 金额全链分整数
    const aa = await call('applyRefund', { orderId: 'o1', lineId: LA, reason: '无理由' })
    expect(ea.refundFen).toBe(toFen(aa.afterSale.refundAmount))

    const eb = await call('estimateRefund', { orderId: 'o1', lineId: LB })
    const ab = await call('applyRefund', { orderId: 'o1', lineId: LB, reason: '无理由' })
    expect(eb.refundFen).toBe(toFen(ab.afterSale.refundAmount))
    expect(ea.refundFen + eb.refundFen).toBe(47500) // 两行合计不超实付
  })

  it('大白话：已有别的售后占了额度——试算按剩余额度算，和真申请一样', async () => {
    seedOrder()
    seedAS(LB, 'approved', 400) // 另一行已同意退 400，只剩 75 可退
    const e = await call('estimateRefund', { orderId: 'o1', lineId: LA })
    expect(e.refundFen).toBe(7500)
    const a = await call('applyRefund', { orderId: 'o1', lineId: LA })
    expect(toFen(a.afterSale.refundAmount)).toBe(e.refundFen)
  })

  it('大白话：顾客撤回的售后不占额度——试算照整份算', async () => {
    seedOrder()
    seedAS(LB, 'withdrawn', 400)
    const e = await call('estimateRefund', { orderId: 'o1', lineId: LA })
    const a = await call('applyRefund', { orderId: 'o1', lineId: LA })
    expect(e.refundFen).toBe(toFen(a.afterSale.refundAmount))
    expect(e.refundFen).toBe(Math.round((47500 * 39600) / 49500))
  })

  it('大白话：只算不写——试算不落售后单', async () => {
    seedOrder()
    expect((await call('estimateRefund', { orderId: 'o1', lineId: LA })).ok).toBe(true)
    expect(asDocs()).toHaveLength(0)
  })
})

describe('estimateRefund 校验与 applyRefund 同口径', () => {
  it('大白话：他人订单当不存在；待支付不可退；不在单内的商品拒；缺参数拒', async () => {
    seedOrder()
    control.setOpenId('oOTHER')
    expect((await call('estimateRefund', { orderId: 'o1', lineId: LA })).error).toBe('NOT_FOUND')
    control.setOpenId('oME')
    seedOrder({ _id: 'oP', id: 'oP', status: 'pending' })
    expect((await call('estimateRefund', { orderId: 'oP', lineId: LA })).error).toBe('BAD_STATUS:pending')
    expect((await call('estimateRefund', { orderId: 'o1', lineId: 'nope' })).error).toBe('UNKNOWN_ITEM:nope')
    expect((await call('estimateRefund', { orderId: 'o1' })).error).toBe('BAD_ARGS')
  })

  it('大白话：已开课（不可退/件数进课完）的行回不可退；已申请过的行回已申请；被拒的行也算申请过', async () => {
    seedOrder({
      items: [
        { productId: 'p1', lineId: LA, spec: '红', name: '小鸭', price: 198, qty: 2, enteredQty: 2, refundable: true },
        { productId: 'p2', lineId: LB, spec: '蓝', name: '云朵鸭', price: 99, qty: 1, refundable: false },
      ],
    })
    expect((await call('estimateRefund', { orderId: 'o1', lineId: LA })).error).toBe('NOT_REFUNDABLE')
    expect((await call('estimateRefund', { orderId: 'o1', lineId: LB })).error).toBe('NOT_REFUNDABLE')

    control.reset()
    control.setOpenId('oME')
    seedOrder()
    seedAS(LA, 'rejected', 0)
    expect((await call('estimateRefund', { orderId: 'o1', lineId: LA })).error).toBe('ALREADY_APPLIED')
  })

  it('大白话：刷太快被频控挡（每分钟 60 次）', async () => {
    let last: any
    for (let i = 0; i < 61; i++) last = await call('estimateRefund', { orderId: 'ghost', lineId: 'x' })
    expect(last.error).toBe('RATE_LIMITED')
  })
})

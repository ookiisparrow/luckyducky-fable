// 黄金 orders-money·applyRefund/refundCallback/confirmReceive/订单读 节（守卫 rw-money3-golden）。
import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as app } from '../src/functions/app/index'
import { main as refundCallback } from '../src/functions/callbacks/refundCallback'

const call = (action: string, data: Record<string, unknown> = {}) => app({ action, data }) as Promise<any>
const cb = (e: Record<string, unknown>) => refundCallback(e) as Promise<any>

// 实付 178 = 商品 198 − 券 20（单品单件基准单）
const seedOrder = (over: Record<string, unknown> = {}) =>
  control.seed('orders', [
    {
      _id: 'o1',
      id: 'o1',
      _openid: 'oME',
      status: 'paid',
      amount: 178,
      goods: 198,
      createdAt: 1000,
      address: { name: '张三', phone: '138', region: 'x', detail: 'y' },
      items: [{ productId: 'p1', lineId: 'p1__基础款', spec: '基础款', name: '小鸭', price: 198, qty: 1, refundable: true }],
      ...over,
    },
  ])

beforeEach(() => {
  control.reset()
  control.setOpenId('oME')
})

describe('applyRefund（黄金：云端分摊·一行一售后·数量级·封顶）', () => {
  it('大白话：他人订单表现为不存在；待支付单不可申请；不在单内的商品拒', async () => {
    seedOrder()
    control.setOpenId('oOTHER')
    expect((await call('applyRefund', { orderId: 'o1', lineId: 'p1__基础款' })).error).toBe('NOT_FOUND')
    control.setOpenId('oME')
    seedOrder({ _id: 'oP', id: 'oP', status: 'pending' } as any)
    expect((await call('applyRefund', { orderId: 'oP', lineId: 'p1__基础款' })).error).toContain('BAD_STATUS')
    expect((await call('applyRefund', { orderId: 'o1', lineId: 'nope' })).error).toContain('UNKNOWN_ITEM')
  })

  it('大白话：退款额云端按占比分摊（不信前端金额）；单品订单退额=全额实付', async () => {
    seedOrder()
    const r = await call('applyRefund', { orderId: 'o1', lineId: 'p1__基础款', refundAmount: 99999 })
    expect(r.ok).toBe(true)
    expect(r.afterSale.refundAmount).toBe(178) // 分摊后=实付全额，前端伪造金额无效
    expect(r.afterSale._id).toBe('o1__p1__基础款')
  })

  it('大白话：一单一行一售后——重复申请拒；同商品不同规格各自可申请；同单累计封顶实付', async () => {
    control.seed('orders', [
      {
        _id: 'o2',
        id: 'o2',
        _openid: 'oME',
        status: 'paid',
        amount: 396,
        goods: 416,
        address: {},
        items: [
          { productId: 'p1', lineId: 'p1__红', spec: '红', name: '鸭', price: 208, qty: 1, refundable: true },
          { productId: 'p1', lineId: 'p1__蓝', spec: '蓝', name: '鸭', price: 208, qty: 1, refundable: true },
        ],
      },
    ])
    const r1 = await call('applyRefund', { orderId: 'o2', lineId: 'p1__红' })
    expect(r1.ok).toBe(true)
    expect((await call('applyRefund', { orderId: 'o2', lineId: 'p1__红' })).error).toBe('ALREADY_APPLIED')
    const r2 = await call('applyRefund', { orderId: 'o2', lineId: 'p1__蓝' })
    expect(r2.ok).toBe(true)
    // 累计封顶：两行分摊之和 ≤ 实付 396
    expect(r1.afterSale.refundAmount + r2.afterSale.refundAmount).toBeLessThanOrEqual(396)
  })

  it('大白话：进课失退货权的行拒退；买 N 进 M 只退剩余件的钱', async () => {
    seedOrder({
      _id: 'o3',
      id: 'o3',
      amount: 574, // 198×3 − 20
      goods: 594,
      items: [{ productId: 'p1', lineId: 'p1__基础款', spec: '基础款', name: '鸭', price: 198, qty: 3, enteredQty: 1, refundable: true }],
    } as any)
    const r = await call('applyRefund', { orderId: 'o3', lineId: 'p1__基础款' })
    expect(r.ok).toBe(true)
    expect(r.afterSale.qty).toBe(2) // 剩余可退 2 件
    expect(r.afterSale.refundAmount).toBeLessThan(574) // 只退 2 件的分摊额

    seedOrder({
      _id: 'o4',
      id: 'o4',
      items: [{ productId: 'p1', lineId: 'p1__基础款', spec: '基础款', name: '鸭', price: 198, qty: 1, refundable: false }],
    } as any)
    expect((await call('applyRefund', { orderId: 'o4', lineId: 'p1__基础款' })).error).toBe('NOT_REFUNDABLE')
  })
})

describe('refundCallback（黄金：防伪·核验 fail-closed·幂等·回补规则）', () => {
  const seedAS = (over: Record<string, unknown> = {}) =>
    control.seed('afterSales', [
      {
        _id: 'o1__p1__基础款',
        orderId: 'o1',
        _openid: 'oME',
        lineId: 'p1__基础款',
        productId: 'p1',
        spec: '基础款',
        qty: 1,
        refundAmount: 178,
        status: 'applied',
        appliedAt: 2000,
        ...over,
      },
    ])
  const SUCCESS = {
    out_refund_no: 'o1__p1__基础款',
    out_trade_no: 'o1',
    refund_status: 'SUCCESS',
    transaction_id: 'wx-rf',
    amount: { refund: 17800 },
  }

  it('大白话：带用户身份的伪造回调不改状态；成功回调置已退款留退款交易号，重复通知幂等', async () => {
    seedOrder()
    seedAS()
    control.setOpenId('oFAKE')
    await cb(SUCCESS)
    expect(control.dump('afterSales')[0].status).toBe('applied')

    control.setOpenId('')
    await cb(SUCCESS)
    const as1 = control.dump('afterSales')[0]
    expect(as1.status).toBe('refunded')
    expect(as1.refundTransactionId).toBe('wx-rf')
    const t1 = as1.refundedAt
    await cb({ ...SUCCESS, transaction_id: 'wx-rf2' })
    expect(control.dump('afterSales')[0].refundTransactionId).toBe('wx-rf') // 幂等不改写
    expect(control.dump('afterSales')[0].refundedAt).toBe(t1)
  })

  it('大白话：核验 fail-closed——单号或金额不符不置已退款、留对账痕；非成功状态留痕不翻态；未知售后单确认不抛', async () => {
    control.setOpenId('')
    seedOrder()
    seedAS()
    await cb({ ...SUCCESS, amount: { refund: 1 } }) // 金额不符
    let as1 = control.dump('afterSales')[0]
    expect(as1.status).toBe('applied')
    expect(as1.refundMismatch).toBe(true)

    await cb({ ...SUCCESS, out_trade_no: 'oWRONG' }) // 单号不符
    expect(control.dump('afterSales')[0].status).toBe('applied')

    await cb({ ...SUCCESS, refund_status: 'CLOSED' }) // 非成功
    as1 = control.dump('afterSales')[0]
    expect(as1.status).toBe('applied')
    expect(as1.refundStatus).toBe('CLOSED')

    expect(await cb({ out_refund_no: 'ghost', refund_status: 'SUCCESS' })).toEqual({ errcode: 0, errmsg: 'OK' })
  })

  it('大白话：退款成功后——未发货单回补库存；已发货单不回补（实物已出库，回补=幻影超卖）', async () => {
    control.setOpenId('')
    // 未发货（paid）→ 回补
    seedOrder()
    seedAS()
    control.seed('inventory', [{ _id: 'p1__基础款', productId: 'p1', spec: '基础款', stock: 0 }])
    await cb(SUCCESS)
    expect(control.dump('inventory')[0].stock).toBe(1)
    expect(control.dump('orders')[0]['refunded.p1'] ?? control.dump('orders')[0].refunded?.p1).toBeTruthy() // 订单留对账痕

    // 已发货（shipped）→ 不回补
    seedOrder({ _id: 'o9', id: 'o9', status: 'shipped' } as any)
    seedAS({ _id: 'o9__p1', orderId: 'o9', lineId: 'p1', qty: 1 } as any)
    control.seed('inventory', [{ _id: 'p1__', productId: 'p1', spec: '', stock: 0 }])
    await cb({ ...SUCCESS, out_refund_no: 'o9__p1', out_trade_no: 'o9' })
    expect(control.dump('afterSales').find((a: any) => a._id === 'o9__p1').status).toBe('refunded')
    expect(control.dump('inventory').find((x: any) => x._id === 'p1__').stock).toBe(0) // 未回补
  })
})

describe('confirmReceive / 订单与售后读（黄金：属主隔离·游标分页·不泄露存在性）', () => {
  it('大白话：只有已发货能确认收货置完成；越状态/重复确认拒', async () => {
    seedOrder({ status: 'shipped' })
    const r = await call('confirmReceive', { id: 'o1' })
    expect(r.ok).toBe(true)
    expect(control.dump('orders')[0].status).toBe('done')
    expect((await call('confirmReceive', { id: 'o1' })).error).toContain('BAD_STATUS:done')
  })

  it('大白话：订单/售后列表只回本人、倒序、游标翻页不重不漏；按单号查他人单与不存在单都是 NOT_FOUND', async () => {
    control.seed(
      'orders',
      Array.from({ length: 12 }, (_, i) => ({
        _id: 'm' + i,
        id: 'm' + i,
        _openid: i % 2 ? 'oME' : 'oOTHER',
        status: 'paid',
        createdAt: 1000 + i,
      }))
    )
    const p1 = await call('getMyOrders', { limit: 3 })
    expect(p1.list.every((o: any) => o._openid === 'oME')).toBe(true)
    expect(p1.list[0].createdAt).toBeGreaterThan(p1.list[2].createdAt)
    const p2 = await call('getMyOrders', { limit: 3, cursor: p1.nextCursor })
    const ids = new Set([...p1.list, ...p2.list].map((o: any) => o._id))
    expect(ids.size).toBe(6)
    expect(p2.hasMore).toBe(false)

    expect((await call('getOrderById', { id: 'm0' })).error).toBe('NOT_FOUND') // 他人单
    expect((await call('getOrderById', { id: 'ghost' })).error).toBe('NOT_FOUND') // 不存在
    expect((await call('getOrderById', { id: 'm1' })).ok).toBe(true) // 本人单

    control.seed('afterSales', [
      { _id: 'a1', _openid: 'oME', orderId: 'm1', status: 'applied', appliedAt: 1 },
      { _id: 'a2', _openid: 'oOTHER', orderId: 'm0', status: 'applied', appliedAt: 2 },
    ])
    const as = await call('getMyAfterSales')
    expect(as.list.length).toBe(1)
    expect(as.list[0]._id).toBe('a1')
  })
})

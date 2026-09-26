// 看板「待发货」只数 shipOne 真会放行的单：退款从不改订单状态，全额退款的单永远停在 paid，
// 按 status=paid 计数会越积越多、还诱导运营去点发货。口径锁法：数出来的数 = 逐单真去发货能成功的单数。
import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as adminApi } from '../src/functions/adminApi/index'
import { sha } from '../src/functions/adminApi/lib'

const post = (action: string, data: Record<string, unknown> = {}) =>
  adminApi({
    httpMethod: 'POST',
    headers: { 'x-forwarded-for': '6.6.6.6' },
    body: JSON.stringify({ action, key: 'super-secret-key', data }),
  }).then((r: any) => JSON.parse(r.body))

const line = (qty: number) => ({ lineId: 'p1__', productId: 'p1', spec: '', name: '小鸭', price: 198, qty })
const ord = (id: string, status: string, over: Record<string, unknown> = {}) => ({
  _id: id, id, _openid: 'oX', status, amount: 198, items: [line(1)], reserved: [], transactionId: 'wx-' + id, createdAt: 1000, ...over,
})
const as = (id: string, orderId: string, status: string, qty: number) => ({ _id: id, orderId, lineId: 'p1__', productId: 'p1', status, qty })

beforeEach(() => {
  control.reset()
  control.setOpenId('')
  control.seed('adminConfig', [{ _id: 'auth', keyHash: sha('super-secret-key'), role: 'superadmin' }])
  control.seed('orders', [
    ord('ship', 'paid'), // 能发
    ord('partial', 'paid', { items: [line(2)] }), // 退了 1 件，剩 1 件照发
    ord('full', 'paid'), // 全额退款后停在 paid
    ord('inflight', 'paid'), // 售后申请中
    ord('fee', 'paid', { feeMismatch: true }), // 金额异常留痕未解除
    ord('shipped', 'shipped'),
    ord('pending', 'pending'),
  ])
  control.seed('afterSales', [as('a1', 'partial', 'refunded', 1), as('a2', 'full', 'refunded', 1), as('a3', 'inflight', 'applied', 1)])
})

describe('getDashboard.toShip：待发货只数真能发的单', () => {
  it('大白话：7 单里 5 单 paid，只有 2 单真能发（全额退款/售后在途/金额异常都不算）', async () => {
    const d = await post('getDashboard')
    expect(d.ok).toBe(true)
    expect(d.toShip).toBe(2)
  })

  it('大白话：和发货闸同一口径——对每张 paid 单真去发货，成功的单数正好等于 toShip', async () => {
    const { toShip } = await post('getDashboard')
    const { list } = await post('listOrders', { status: 'paid' })
    let shipped = 0
    for (const o of list) {
      const r = await post('shipOrder', { id: o._id, company: '顺丰', trackingNo: 'SF-' + o._id, ackRefundedQty: o.refundedQty })
      if (r.ok) shipped++
    }
    expect(list.length).toBe(5)
    expect(shipped).toBe(toShip)
  })

  it('大白话：待发货超过一页（200 单）也数全，不停在第一页', async () => {
    control.seed('orders', Array.from({ length: 203 }, (_, i) => ord('bulk' + i, 'paid', { createdAt: 2000 + (i % 7) })))
    expect((await post('getDashboard')).toShip).toBe(2 + 203)
  })

  it('大白话：按单号联查售后失败——看板整体报错，不把「没查到」当成「都能发」', async () => {
    control.setBeforeGet(async ({ coll, filter }: any) => {
      if (coll === 'afterSales' && filter && filter.orderId) throw new Error('MOCK_READ_FAIL')
    })
    const d = await post('getDashboard')
    expect(d.ok).not.toBe(true)
    expect(d.toShip).toBeUndefined()
  })
})

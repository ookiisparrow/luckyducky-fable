// 下单/订单动作的读失败与频控、定时关单、热路径建集合（钱链健壮性）。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import cloud, { control } from 'wx-server-sdk'
import { COLLECTIONS } from '@ldrw/shared'
import { main as app } from '../src/functions/app/index'
import { main as adminApi } from '../src/functions/adminApi/index'
import { sha } from '../src/functions/adminApi/lib'
import { main as closeExpired } from '../src/functions/timers/closeExpiredOrders'
import { transition } from '../src/kit'

const call = (action: string, data: Record<string, unknown> = {}) => app({ action, data }) as Promise<any>
const post = (action: string, data: Record<string, unknown> = {}) =>
  adminApi({
    httpMethod: 'POST',
    headers: { 'x-forwarded-for': '1.1.1.1' },
    body: JSON.stringify({ action, key: 'super-secret-key', data }),
  }).then((r: any) => ({ status: r.statusCode, ...JSON.parse(r.body) }))
const alerted = (code: string) => control.dump('anomalies').some((a: any) => a.code === code)
const ADDR = { name: '张三', phone: '13800000000', region: '浙江·杭州', detail: 'xx 路 1 号' }
const failOrderDoc = (id: string) =>
  control.setBeforeGet(async (a: any) => {
    if (a.coll === 'orders' && a.id === id) throw new Error('MOCK_READ_FAIL')
  })
const seedOrder = (over: Record<string, unknown> = {}) =>
  control.seed('orders', [
    {
      _id: 'o1',
      id: 'o1',
      _openid: 'oME',
      status: 'paid',
      amount: 100,
      goods: 100,
      createdAt: Date.now(),
      items: [{ productId: 'p1', lineId: 'p1__', spec: '', name: '鸭', price: 100, qty: 1, refundable: true }],
      ...over,
    },
  ])

beforeEach(() => {
  control.reset()
  control.setOpenId('oME')
  control.seed('config', [{ _id: 'pay', mode: 'real', flowId: 'flow-pay' }])
  control.seed('products', [{ _id: 'p1', id: 'p1', name: '鸭', price: 100, tag: '' }])
  vi.restoreAllMocks()
})

describe('createOrder 在途单计数失败拒单', () => {
  it('大白话：数不清在途单就不放行（不当成 0 单），不扣库存不建单', async () => {
    control.seed('inventory', [{ _id: 'p1__', productId: 'p1', spec: '', stock: 5 }])
    control.setBeforeCount(async ({ coll }: any) => {
      if (coll === 'orders') throw new Error('MOCK_COUNT_FAIL')
    })
    const r = await call('createOrder', { items: [{ id: 'p1', qty: 1 }], address: ADDR })
    expect(r.error).toBe('INTERNAL')
    expect(control.dump('orders').length).toBe(0)
    expect(control.dump('inventory')[0].stock).toBe(5)
  })
})

describe('订单读失败≠没有这单', () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ['pay', { id: 'o1' }],
    ['applyRefund', { orderId: 'o1', lineId: 'p1__' }],
    ['confirmReceive', { id: 'o1' }],
    ['cancelOrder', { id: 'o1' }],
  ]
  for (const [action, data] of cases)
    it(`大白话：${action} 读订单失败回 INTERNAL，不回 NOT_FOUND`, async () => {
      seedOrder()
      failOrderDoc('o1')
      expect((await call(action, data)).error).toBe('INTERNAL')
    })

  it('大白话：真没有这单仍回 NOT_FOUND', async () => {
    expect((await call('cancelOrder', { id: 'ghost' })).error).toBe('NOT_FOUND')
  })

  it('大白话：状态流转闸读失败要抛，不能说成「状态不对」；缺档仍是没流转', async () => {
    seedOrder({ status: 'pending' })
    failOrderDoc('o1')
    await expect(transition(COLLECTIONS.orders, 'o1', ['pending'], 'closed')).rejects.toThrow()
    control.setBeforeGet(null as never)
    expect(await transition(COLLECTIONS.orders, 'ghost', ['pending'], 'closed')).toEqual({ moved: false })
  })

  it('大白话：后台看售后详情时订单读失败——报错，不显示「可退」', async () => {
    control.setOpenId('')
    control.seed('adminConfig', [{ _id: 'auth', keyHash: sha('super-secret-key'), role: 'superadmin' }])
    seedOrder()
    control.seed('afterSales', [{ _id: 'as1', orderId: 'o1', _openid: 'oME', lineId: 'p1__', productId: 'p1', status: 'applied' }])
    failOrderDoc('o1')
    const r = await post('getRefundDetail', { id: 'as1' })
    expect(r.status).toBe(500)
    expect(r.lineRefundable).toBeUndefined()
  })
})

describe('订单写动作频控', () => {
  for (const action of ['applyRefund', 'cancelOrder', 'confirmReceive'])
    it(`大白话：${action} 一分钟内第 21 次被限速`, async () => {
      let last: any
      for (let i = 0; i < 21; i++) last = await call(action, { id: 'ghost', orderId: 'ghost', lineId: 'x' })
      expect(last.error).toBe('RATE_LIMITED')
    })
})

describe('热路径不每单建集合', () => {
  it('大白话：集合已在——下单、申请售后都不调 createCollection', async () => {
    const spy = vi.spyOn(cloud.database(), 'createCollection')
    const r = await call('createOrder', { items: [{ id: 'p1', qty: 1 }], address: ADDR, idempotencyKey: 'k1' })
    expect(r.ok).toBe(true)
    seedOrder()
    expect((await call('applyRefund', { orderId: 'o1', lineId: 'p1__' })).ok).toBe(true)
    expect(spy).not.toHaveBeenCalled()
  })

  it('大白话：集合还没建——建一次再写，照常成功', async () => {
    control.markUncreated(COLLECTIONS.orderIdempotency)
    control.markUncreated(COLLECTIONS.afterSales)
    const spy = vi.spyOn(cloud.database(), 'createCollection')
    const r = await call('createOrder', { items: [{ id: 'p1', qty: 1 }], address: ADDR, idempotencyKey: 'k2' })
    expect(r.ok).toBe(true)
    expect(control.dump(COLLECTIONS.orderIdempotency).length).toBe(1)
    seedOrder()
    expect((await call('applyRefund', { orderId: 'o1', lineId: 'p1__' })).ok).toBe(true)
    expect(control.dump(COLLECTIONS.afterSales).length).toBe(1)
    expect(spy.mock.calls.map((c) => c[0]).sort()).toEqual([COLLECTIONS.afterSales, COLLECTIONS.orderIdempotency].sort())
  })
})

describe('closeExpiredOrders', () => {
  const expired = (n: number) =>
    control.seed(
      'orders',
      Array.from({ length: n }, (_, i) => ({
        _id: 'e' + i,
        id: 'e' + i,
        status: 'pending',
        createdAt: Date.now() - 60 * 60 * 1000,
        reserved: [{ productId: 'p1', spec: '', qty: 1 }],
      }))
    )

  it('大白话：读待关单失败要告警，不静默当成 0 单', async () => {
    control.setOpenId('')
    expired(2)
    control.setBeforeGet(async (a: any) => {
      if (a.coll === 'orders' && a.filter) throw new Error('MOCK_READ_FAIL')
    })
    const r: any = await closeExpired()
    expect(r.ok).toBe(false)
    expect(alerted('EXPIRED_ORDERS_READ_FAIL')).toBe(true)
  })

  it('大白话：一批过期单有界并发地关（不再一单一单串行），每单先关后回补、回补只一次', async () => {
    control.setOpenId('')
    control.seed('inventory', [{ _id: 'p1__', productId: 'p1', spec: '', stock: 0 }])
    expired(12)
    let inflight = 0
    let peak = 0
    control.setBeforeUpdate(async ({ coll, data }: any) => {
      if (coll !== 'orders' || data.status !== 'closed') return
      peak = Math.max(peak, ++inflight)
      await new Promise((r) => setTimeout(r, 5))
      inflight--
    })
    const r: any = await closeExpired()
    expect(r.closed).toBe(12)
    expect(peak).toBeGreaterThan(1)
    expect(peak).toBeLessThanOrEqual(5)
    expect(control.dump('inventory')[0].stock).toBe(12)
    control.setBeforeUpdate(null as never)
    expect(((await closeExpired()) as any).closed).toBe(0) // 再跑不重复回补
    expect(control.dump('inventory')[0].stock).toBe(12)
  })
})

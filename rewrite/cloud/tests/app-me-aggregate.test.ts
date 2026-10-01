// 性能批 #1/#3/#4（老板 2026-10-01）：「我」/订单/课程三页往返合并的行为——属主隔离、状态口径、部分失败不整包失败。
// 键集合哨兵在 contract-shape.test.ts；这里钉值与分治。
import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as app } from '../src/functions/app/index'

const call = (action: string, data: Record<string, unknown> = {}) => app({ action, data }) as Promise<any>

beforeEach(() => {
  control.reset()
  control.setOpenId('oME')
})

describe('countMyOrders（「我」页订单格数字）', () => {
  it('大白话：只数本人、只数待支付/待发货/待收货三态；已完成/关闭不进数字；别人的单不进', async () => {
    control.seed('orders', [
      { _id: 'a', _openid: 'oME', status: 'pending', createdAt: 1 },
      { _id: 'b', _openid: 'oME', status: 'paid', createdAt: 2 },
      { _id: 'c', _openid: 'oME', status: 'paid', createdAt: 3 },
      { _id: 'd', _openid: 'oME', status: 'shipped', createdAt: 4 },
      { _id: 'e', _openid: 'oME', status: 'done', createdAt: 5 },
      { _id: 'f', _openid: 'oME', status: 'closed', createdAt: 6 },
      { _id: 'g', _openid: 'oX', status: 'pending', createdAt: 7 },
    ])
    expect(await call('countMyOrders')).toEqual({ ok: true, counts: { pending: 1, paid: 2, shipped: 1 } })
  })

  it('大白话：一单没有也是 0（不是缺键、不是 null）', async () => {
    expect(await call('countMyOrders')).toEqual({ ok: true, counts: { pending: 0, paid: 0, shipped: 0 } })
  })
})

describe('getMyOrders withAfterSales（订单列表一次带回售后）', () => {
  it('大白话：带 flag 时附本人售后（别人的不附）；不带 flag 时没有 afterSales 键，老调用方不受影响', async () => {
    control.seed('orders', [{ _id: 'o1', id: 'o1', _openid: 'oME', status: 'paid', createdAt: 1, items: [] }])
    control.seed('afterSales', [
      { _id: 'as1', _openid: 'oME', orderId: 'o1', lineId: 'L1', status: 'applied', appliedAt: 10 },
      { _id: 'as2', _openid: 'oX', orderId: 'o9', lineId: 'L1', status: 'applied', appliedAt: 11 },
    ])
    const r = await call('getMyOrders', { withAfterSales: true })
    expect(r.ok).toBe(true)
    expect(r.list.map((o: any) => o._id)).toEqual(['o1'])
    expect(r.afterSales.map((a: any) => a._id)).toEqual(['as1'])
    const plain = await call('getMyOrders')
    expect('afterSales' in plain).toBe(false)
  })
})

describe('getMyLearning（我的课 + 进度一次往返）', () => {
  it('大白话：courses 只认已确认进课（同课多码取最早），progress 只本人；两路各自独立', async () => {
    control.seed('activations', [
      { _id: 'A1', _openid: 'oME', courseId: 'c1', enteredAt: 300, createdAt: 1 },
      { _id: 'A2', _openid: 'oME', courseId: 'c1', enteredAt: 100, createdAt: 2 },
      { _id: 'A3', _openid: 'oME', courseId: 'c2', enteredAt: null, createdAt: 3 },
      { _id: 'A4', _openid: 'oX', courseId: 'c3', enteredAt: 5, createdAt: 4 },
    ])
    control.seed('progress', [
      { _id: 'P1', _openid: 'oME', courseId: 'c1', done: { s1: true }, createdAt: 1, updatedAt: 2 },
      { _id: 'P2', _openid: 'oX', courseId: 'c3', done: {}, createdAt: 1, updatedAt: 2 },
    ])
    const r = await call('getMyLearning')
    expect(r.ok).toBe(true)
    expect(r.courses).toEqual([{ courseId: 'c1', enteredAt: 100 }])
    expect(r.progress.map((p: any) => p._id)).toEqual(['P1'])
  })

  it('大白话：进度库挂了 → courses 照给、progress 给 null（页面显「进度读不到」而不是谎报 0%）', async () => {
    control.seed('activations', [{ _id: 'A1', _openid: 'oME', courseId: 'c1', enteredAt: 100, createdAt: 1 }])
    control.setBeforeGet(({ coll }: { coll: string }) => {
      if (coll === 'progress') throw new Error('MOCK: progress 库挂')
    })
    const r = await call('getMyLearning')
    expect(r.ok).toBe(true)
    expect(r.courses).toEqual([{ courseId: 'c1', enteredAt: 100 }])
    expect(r.progress).toBe(null)
  })
})

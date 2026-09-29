// 订单接口带「哪些行已评价」（老板 2026-09-29 拍板 6）：getMyOrders / getOrderById 每单带 reviewedLineIds。
// 规则：只读评价集合（本人 + 这页订单一次批量查），不改订单文档；评价读失败不拖垮订单接口（不带该字段 + 记账）。
import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as app } from '../src/functions/app/index'

const call = (action: string, data: Record<string, unknown> = {}) => app({ action, data }) as Promise<any>
const L = (lineId: string) => ({ productId: lineId.split('__')[0], lineId, spec: '', name: '鸭', price: 99, qty: 1, cover: '' })
const order = (id: string, status: string, lines: string[], createdAt: number) => ({
  _id: id, id, _openid: 'oME', status, amount: 99, goods: 99, createdAt, items: lines.map(L),
})
const review = (orderId: string, lineId: string, openid = 'oME') => ({
  _id: `${orderId}__${lineId}`, _openid: openid, orderId, lineId, productId: lineId.split('__')[0], rating: 5, createdAt: 1, picked: false,
})
const reviewReads = () => (control as any).__reviewReads as number

beforeEach(() => {
  control.reset()
  control.setOpenId('oME')
  control.seed('orders', [
    order('oDone', 'done', ['p1__a', 'p2__b'], 3000),
    order('oDone2', 'done', ['p3__c'], 2000),
    order('oPaid', 'paid', ['p1__a'], 1000),
  ])
  control.seed('reviews', [review('oDone', 'p1__a'), review('oDone2', 'p3__c'), review('oDone', 'p2__b', 'oOTHER')])
  ;(control as any).__reviewReads = 0
  control.setBeforeGet(async (a: any) => {
    if (a.coll === 'reviews') (control as any).__reviewReads++
  })
})

describe('订单带已评价行', () => {
  it('大白话：列表里每单带上已评价的行——只认本人的评价；没评过/未完成的单是空数组；整页只查一次评价（不逐单查）', async () => {
    const r = await call('getMyOrders')
    expect(r.ok).toBe(true)
    const by = Object.fromEntries(r.list.map((o: any) => [o.id, o.reviewedLineIds]))
    expect(by).toEqual({ oDone: ['p1__a'], oDone2: ['p3__c'], oPaid: [] })
    expect(reviewReads()).toBe(1)
  })

  it('大白话：单张订单详情也带；订单文档本身不被改', async () => {
    const r = await call('getOrderById', { id: 'oDone' })
    expect(r.order.reviewedLineIds).toEqual(['p1__a'])
    const doc = (control.dump('orders') as any[]).find((o) => o._id === 'oDone')
    expect('reviewedLineIds' in doc).toBe(false)
  })

  it('大白话：没有已完成的单——不去查评价', async () => {
    const r = await call('getOrderById', { id: 'oPaid' })
    expect(r.order.reviewedLineIds).toEqual([])
    expect(reviewReads()).toBe(0)
  })

  it('大白话：评价读失败——订单照常返回（只是不带已评价字段），并记一笔异常账', async () => {
    control.setBeforeGet(async (a: any) => {
      if (a.coll === 'reviews') throw new Error('MOCK_READ_FAIL')
    })
    const r = await call('getMyOrders')
    expect(r.ok).toBe(true)
    expect(r.list).toHaveLength(3)
    expect(r.list.every((o: any) => !('reviewedLineIds' in o))).toBe(true)
    const d = await call('getOrderById', { id: 'oDone' })
    expect(d.ok).toBe(true)
    expect('reviewedLineIds' in d.order).toBe(false)
    expect((control.dump('anomalies') as any[]).some((a) => a.code === 'REVIEWED_READ_FAIL')).toBe(true)
  })

  it('大白话：评价集合还没建（一条评价都没有过）——当都没评过，不算异常', async () => {
    control.setBeforeGet(async (a: any) => {
      if (a.coll === 'reviews') throw new Error('DATABASE_COLLECTION_NOT_EXIST:reviews')
    })
    const r = await call('getOrderById', { id: 'oDone' })
    expect(r.order.reviewedLineIds).toEqual([])
    expect((control.dump('anomalies') as any[] | undefined)?.length ?? 0).toBe(0)
  })
})

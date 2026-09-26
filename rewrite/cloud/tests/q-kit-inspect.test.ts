// 巡检：卡单只豁免在途售后（部分退款后剩余行/剩余件照报）+ 超支付窗仍 pending（关单定时任务兜底）。
import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { runInspection } from '../src/kit'
import { COLLECTIONS, PAY_WINDOW_MS } from '@ldrw/shared'

const HOUR = 3600 * 1000

beforeEach(() => control.reset())

function entry(run: Awaited<ReturnType<typeof runInspection>>, id: string) {
  const r = run.results.find((x) => x.id === id)
  expect(r, `检查项 ${id} 必须在报告里`).toBeTruthy()
  return r!
}

const twoLinePaid = (id: string) => ({
  _id: id,
  status: 'paid',
  amount: 200,
  goods: 200,
  items: [
    { lineId: 'l1', price: 100, qty: 1 },
    { lineId: 'l2', price: 100, qty: 1 },
  ],
  transactionId: 'wx' + id,
  paidAt: Date.now() - 80 * HOUR,
})

describe('卡单：只豁免在途售后', () => {
  it('大白话：两行单退了一行、另一行 80h 没发→报卡单（钱收了剩下的货没发）', async () => {
    control.seed(COLLECTIONS.orders, [twoLinePaid('P')])
    control.seed(COLLECTIONS.afterSales, [{ _id: 'P__l1', orderId: 'P', lineId: 'l1', status: 'refunded', refundAmount: 100 }])
    const stuck = entry(await runInspection('timer'), 'stuck-order')
    expect(stuck.status).toBe('red')
    expect(stuck.samples).toEqual(['P'])
  })

  it('大白话：每一行都退了→没东西可发·不算卡单', async () => {
    control.seed(COLLECTIONS.orders, [twoLinePaid('F')])
    control.seed(COLLECTIONS.afterSales, [
      { _id: 'F__l1', orderId: 'F', lineId: 'l1', qty: 1, status: 'refunded', refundAmount: 100 },
      { _id: 'F__l2', orderId: 'F', lineId: 'l2', qty: 1, status: 'refunded', refundAmount: 100 },
    ])
    expect(entry(await runInspection('timer'), 'stuck-order').status).toBe('green')
  })

  it('大白话：一行买 2 件、进课 1 件只退了 1 件→还剩 1 件没发·报卡单', async () => {
    control.seed(COLLECTIONS.orders, [
      {
        _id: 'Q',
        status: 'paid',
        amount: 200,
        goods: 200,
        items: [{ lineId: 'l1', price: 100, qty: 2, enteredQty: 1 }],
        transactionId: 'wxQ',
        paidAt: Date.now() - 80 * HOUR,
      },
    ])
    control.seed(COLLECTIONS.afterSales, [{ _id: 'Q__l1', orderId: 'Q', lineId: 'l1', qty: 1, status: 'refunded', refundAmount: 100 }])
    const stuck = entry(await runInspection('timer'), 'stuck-order')
    expect(stuck.status).toBe('red')
    expect(stuck.samples).toEqual(['Q'])
  })

  it('大白话：一行退完、另一行申请中（在途）→正在退款·豁免', async () => {
    control.seed(COLLECTIONS.orders, [twoLinePaid('I')])
    control.seed(COLLECTIONS.afterSales, [
      { _id: 'I__l1', orderId: 'I', lineId: 'l1', status: 'refunded', refundAmount: 100 },
      { _id: 'I__l2', orderId: 'I', lineId: 'l2', status: 'applied', refundAmount: 100 },
    ])
    expect(entry(await runInspection('timer'), 'stuck-order').status).toBe('green')
  })
})

describe('超支付窗仍 pending（关单任务失败的兜底）', () => {
  it('大白话：下单超窗 2 小时还是 pending→红·落账本', async () => {
    control.seed(COLLECTIONS.orders, [
      { _id: 'OLD', status: 'pending', amount: 100, createdAt: Date.now() - PAY_WINDOW_MS - 2 * HOUR },
      { _id: 'NEW', status: 'pending', amount: 100, createdAt: Date.now() - 60 * 1000 },
    ])
    const run = await runInspection('timer')
    const r = entry(run, 'pending-overdue')
    expect(r.status).toBe('red')
    expect(r.count).toBe(1)
    expect(r.samples).toEqual(['OLD'])
    expect(control.dump(COLLECTIONS.anomalies).some((a: any) => a.code === 'INSPECT_PENDING_OVERDUE')).toBe(true)
  })

  it('大白话：刚过支付窗几分钟（关单任务每 5 分钟跑·还没轮到）→不报', async () => {
    control.seed(COLLECTIONS.orders, [{ _id: 'JUST', status: 'pending', amount: 100, createdAt: Date.now() - PAY_WINDOW_MS - 10 * 60 * 1000 }])
    expect(entry(await runInspection('timer'), 'pending-overdue').status).toBe('green')
  })

  it('大白话：pending 扫描炸→红/high（读不到≠没有）', async () => {
    control.setBeforeGet(({ coll, filter }: any) => {
      if (coll === COLLECTIONS.orders && filter && filter.status === 'pending') throw new Error('boom')
    })
    const r = entry(await runInspection('timer'), 'pending-overdue')
    expect(r.status).toBe('red')
    expect(r.severity).toBe('high')
    expect(r.detail).toBe('检查自身异常：Error: boom')
  })
})

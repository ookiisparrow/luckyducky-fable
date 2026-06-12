import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main } from '../../cloudfunctions/payCallback/index.js'

// payCallback 幂等：pending→paid 只生效一次；closed 复活；失败通知不改状态；一律 ACK。
const NOTIFY = {
  returnCode: 'SUCCESS',
  resultCode: 'SUCCESS',
  outTradeNo: 'p1',
  totalFee: 17800,
  transactionId: 'tx-001',
}

beforeEach(() => {
  control.reset()
  control.seed('orders', [
    { _id: 'p1', id: 'p1', status: 'pending', amount: 178, createdAt: Date.now() },
    { _id: 'p2', id: 'p2', status: 'paid', amount: 178, paidAt: 111, transactionId: 'tx-old' },
    { _id: 'c1', id: 'c1', status: 'closed', amount: 50, closedAt: 222 },
  ])
})

describe('payCallback 回调幂等', () => {
  it('pending → paid + paidAt + transactionId，返回 ACK', async () => {
    const res = await main(NOTIFY)
    expect(res.errcode).toBe(0)
    const p1 = control.dump('orders').find((o) => o._id === 'p1')
    expect(p1.status).toBe('paid')
    expect(p1.paidAt).toBeGreaterThan(0)
    expect(p1.transactionId).toBe('tx-001')
    expect(p1.feeMismatch).toBeUndefined()
  })

  it('幂等：已 paid 的单收到重复通知，paidAt/transactionId 不被改写', async () => {
    const res = await main({ ...NOTIFY, outTradeNo: 'p2', transactionId: 'tx-dup' })
    expect(res.errcode).toBe(0)
    const p2 = control.dump('orders').find((o) => o._id === 'p2')
    expect(p2.paidAt).toBe(111)
    expect(p2.transactionId).toBe('tx-old')
  })

  it('resultCode 非 SUCCESS：不改状态（取消/失败单留 pending）', async () => {
    await main({ ...NOTIFY, resultCode: 'FAIL' })
    expect(control.dump('orders').find((o) => o._id === 'p1').status).toBe('pending')
  })

  it('closed 后回调到达：钱已收，订单复活置 paid', async () => {
    await main({ ...NOTIFY, outTradeNo: 'c1', totalFee: 5000, transactionId: 'tx-late' })
    const c1 = control.dump('orders').find((o) => o._id === 'c1')
    expect(c1.status).toBe('paid')
    expect(c1.transactionId).toBe('tx-late')
  })

  it('金额不符：照常置 paid 但留 feeMismatch 痕（人工对账）', async () => {
    await main({ ...NOTIFY, totalFee: 1 })
    const p1 = control.dump('orders').find((o) => o._id === 'p1')
    expect(p1.status).toBe('paid')
    expect(p1.feeMismatch).toBe(true)
  })

  it('未知订单号 / 缺单号：ACK 不抛（微信重试无意义）', async () => {
    expect((await main({ ...NOTIFY, outTradeNo: 'nope' })).errcode).toBe(0)
    expect((await main({})).errcode).toBe(0)
  })
})

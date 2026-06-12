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
  control.setOpenId('') // 工作流服务端调用无用户上下文（防伪闸放行通道）
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

  it('防伪闸：带用户身份的调用（客户端伪造）一律不改状态', async () => {
    control.setOpenId('attacker-openid') // 小程序客户端 callFunction 必带 OPENID
    const res = await main(NOTIFY)
    expect(res.errcode).toBe(0) // 静默确认，不给探测信号
    expect(control.dump('orders').find((o) => o._id === 'p1').status).toBe('pending') // 未被翻 paid
  })
})

describe('payCallback v3 工作流回调形态（resource 字段）', () => {
  const V3 = {
    out_trade_no: 'p1',
    trade_state: 'SUCCESS',
    transaction_id: 'tx-v3',
    amount: { total: 17800, payer_total: 17800 },
  }

  it('v3 成功通知：pending → paid + transactionId', async () => {
    const res = await main(V3)
    expect(res.errcode).toBe(0)
    const p1 = control.dump('orders').find((o) => o._id === 'p1')
    expect(p1.status).toBe('paid')
    expect(p1.transactionId).toBe('tx-v3')
    expect(p1.feeMismatch).toBeUndefined()
  })

  it('v3 非 SUCCESS（NOTPAY/CLOSED 等）：不改状态', async () => {
    await main({ ...V3, trade_state: 'NOTPAY' })
    expect(control.dump('orders').find((o) => o._id === 'p1').status).toBe('pending')
  })

  it('v3 金额不符：置 paid 但留 feeMismatch 痕', async () => {
    await main({ ...V3, amount: { total: 17800, payer_total: 1 } })
    const p1 = control.dump('orders').find((o) => o._id === 'p1')
    expect(p1.status).toBe('paid')
    expect(p1.feeMismatch).toBe(true)
  })

  it('v3 幂等：已 paid 重复通知不改写', async () => {
    await main({ ...V3, out_trade_no: 'p2', transaction_id: 'tx-dup' })
    const p2 = control.dump('orders').find((o) => o._id === 'p2')
    expect(p2.paidAt).toBe(111)
    expect(p2.transactionId).toBe('tx-old')
  })
})

// 支付状态机单元测试（payCallback onNotify）——覆盖 pending→paid 正常路径、
// 金额不符→payment_exception、未知订单、幂等、关单复活（closed→paid 重抢库存）、
// 库存不足→refund_required。纯 control mock 数据库，不碰真库/真钱。
import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as payCallback } from '../src/functions/callbacks/payCallback'
import { captureAlerts } from './helpers/alerts'

const order = (over: Record<string, unknown> = {}) => ({
  _id: 'o1',
  amount: 100, // 元
  status: 'pending',
  reserved: [{ productId: 'p1', spec: '', qty: 1 }],
  createdAt: 1,
  ...over,
})
const inventory = (stock: number | null) => ({ _id: 'p1__', productId: 'p1', spec: '', stock })

// 构造 SUCCESS 回调（payer_total 单位：分）
const payEvent = (over: Record<string, unknown> = {}) => ({
  out_trade_no: 'o1',
  trade_state: 'SUCCESS',
  transaction_id: 'txn-1',
  amount: { payer_total: 10000, total: 10000 }, // 100 元 = 10000 分
  ...over,
})

beforeEach(() => {
  control.reset()
  control.setOpenId('') // 真微信回调无用户上下文；不设空则 isServerCall=false → 全部当伪造拒
})

describe('payCallback 状态机（黄金 money·payCallback 节）', () => {
  it('正常支付：pending → paid，写 paidAt + transactionId', async () => {
    control.seed('orders', [order()])
    control.seed('inventory', [inventory(5)])
    await payCallback(payEvent())
    const o = control.dump('orders').find((d: any) => d._id === 'o1')
    expect(o.status).toBe('paid')
    expect(o.transactionId).toBe('txn-1')
    expect(typeof o.paidAt).toBe('number')
  })

  it('欠付：payer_total < 应付 → payment_exception + FEE_MISMATCH 告警 + 库存回补', async () => {
    control.seed('orders', [order()])
    control.seed('inventory', [inventory(4)]) // 下单已扣 1（seed 5→4），欠付回补后 5
    const alerts = await captureAlerts(() => payCallback(payEvent({ amount: { payer_total: 5000, total: 5000 } })))
    const o = control.dump('orders').find((d: any) => d._id === 'o1')
    expect(o.status).toBe('payment_exception')
    expect(o.feeMismatch).toBe(true)
    expect(o.paymentMismatchDirection).toBe('underpaid')
    expect(alerts.some((a) => a.includes('FEE_MISMATCH'))).toBe(true)
    const inv = control.dump('inventory').find((d: any) => d._id === 'p1__')
    expect(inv.stock).toBe(5) // 未履约·库存回补
  })

  it('多付：payer_total > 应付 → payment_exception + overpaid', async () => {
    control.seed('orders', [order()])
    control.seed('inventory', [inventory(5)])
    await payCallback(payEvent({ amount: { payer_total: 15000, total: 15000 } }))
    const o = control.dump('orders').find((d: any) => d._id === 'o1')
    expect(o.status).toBe('payment_exception')
    expect(o.paymentMismatchDirection).toBe('overpaid')
  })

  it('未知订单：UNKNOWN_ORDER 告警·不落新单·返回 ACK', async () => {
    const alerts = await captureAlerts(() => payCallback(payEvent({ out_trade_no: 'no-such-order' })))
    expect(control.dump('orders').length).toBe(0)
    expect(alerts.some((a) => a.includes('UNKNOWN_ORDER'))).toBe(true)
  })

  it('非 SUCCESS 回调：不处理·订单保持 pending', async () => {
    control.seed('orders', [order()])
    await payCallback(payEvent({ trade_state: 'NOTPAY' }))
    const o = control.dump('orders').find((d: any) => d._id === 'o1')
    expect(o.status).toBe('pending')
  })

  it('幂等：已 paid 订单重复回调 → 状态不变·无二次告警', async () => {
    control.seed('orders', [order({ status: 'paid', paidAt: 100, transactionId: 'txn-0' })])
    const alerts = await captureAlerts(() => payCallback(payEvent()))
    const o = control.dump('orders').find((d: any) => d._id === 'o1')
    expect(o.status).toBe('paid')
    expect(o.paidAt).toBe(100) // 未被改写
    expect(o.transactionId).toBe('txn-0')
    expect(alerts.filter((a) => a.includes('FEE_MISMATCH') || a.includes('UNEXPECTED_STATUS')).length).toBe(0)
  })

  it('关单复活：closed + 金额匹配 + 库存可抢 → paid + revivedAt + 库存扣减', async () => {
    control.seed('orders', [order({ status: 'closed', closedAt: 100, reserved: [{ productId: 'p1', spec: '', qty: 1 }] })])
    control.seed('inventory', [inventory(5)])
    await payCallback(payEvent())
    const o = control.dump('orders').find((d: any) => d._id === 'o1')
    expect(o.status).toBe('paid')
    expect(typeof o.revivedAt).toBe('number')
    const inv = control.dump('inventory').find((d: any) => d._id === 'p1__')
    expect(inv.stock).toBe(4) // 重抢 1 件
  })

  it('关单 + 金额不符：→ payment_exception·不重抢库存', async () => {
    control.seed('orders', [order({ status: 'closed', closedAt: 100, reserved: [{ productId: 'p1', spec: '', qty: 1 }] })])
    control.seed('inventory', [inventory(5)])
    const alerts = await captureAlerts(() => payCallback(payEvent({ amount: { payer_total: 5000, total: 5000 } })))
    const o = control.dump('orders').find((d: any) => d._id === 'o1')
    expect(o.status).toBe('payment_exception')
    expect(o.paymentMismatchDirection).toBe('underpaid')
    expect(alerts.some((a) => a.includes('FEE_MISMATCH'))).toBe(true)
    const inv = control.dump('inventory').find((d: any) => d._id === 'p1__')
    expect(inv.stock).toBe(5) // 不重抢
  })

  it('关单 + 库存不足：→ refund_required（钱已收·绝不超卖·告警人工退款）', async () => {
    control.seed('orders', [order({ status: 'closed', closedAt: 100, reserved: [{ productId: 'p1', spec: '', qty: 1 }] })])
    control.seed('inventory', [inventory(0)]) // 库存为 0
    const alerts = await captureAlerts(() => payCallback(payEvent()))
    const o = control.dump('orders').find((d: any) => d._id === 'o1')
    expect(o.status).toBe('refund_required')
    expect(alerts.some((a) => a.includes('PAID_BUT_OOS'))).toBe(true) // 告警人工退款
  })
})

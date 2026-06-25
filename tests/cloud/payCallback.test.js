import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main, reserveWithRetry } from '../../packages/cloud/src/functions/orders/payCallback'

// reserveWithRetry 竞态缓冲（审计 P2·关单回补非原子）：closed 复活重抢失败若是「关单回补未落定」瞬时窗，
// 重试即成功（不误判售罄）；真售罄重试仍失败 → 上层走 refund_required（不超卖）。sleep 注入·不真等。
describe('reserveWithRetry 竞态缓冲（审计 P2）', () => {
  const noSleep = async () => {}
  it('首次失败、回补落定后第二次成功 → ok（不误判 refund_required）', async () => {
    let n = 0
    const reserve = async () => (++n >= 2 ? { ok: true, reserved: [{ productId: 'x', spec: '', qty: 1 }] } : { ok: false, reserved: [] })
    const r = await reserveWithRetry(reserve, { tries: 3, sleep: noSleep })
    expect(r.ok).toBe(true)
    expect(n).toBe(2) // 重试到成功
  })
  it('真售罄：重试到上限仍失败 → ok:false（上层 refund_required·不超卖）', async () => {
    let n = 0
    const reserve = async () => {
      n++
      return { ok: false, reserved: [] }
    }
    const r = await reserveWithRetry(reserve, { tries: 3, sleep: noSleep })
    expect(r.ok).toBe(false)
    expect(n).toBe(3) // 用满重试次数
  })
  it('首次即成功：不重试（常态零额外开销）', async () => {
    let n = 0
    const reserve = async () => {
      n++
      return { ok: true, reserved: [] }
    }
    const r = await reserveWithRetry(reserve, { tries: 3, sleep: noSleep })
    expect(r.ok).toBe(true)
    expect(n).toBe(1)
  })
})

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

// 关单回补后晚到的成功回调（审核 P0·根因#1/#2 防超卖）：closed 单库存已在关单时回补，
// 复活 paid 前须**重抢库存**——抢到才翻 paid，抢不到（已被别人买走）进 refund_required 待退款态。
describe('payCallback 关单后晚到回调·库存重抢防超卖（审核 P0·根因#1/#2）', () => {
  const inv = (id) => control.dump('inventory').find((d) => d._id === id)
  const find = (oid) => control.dump('orders').find((o) => o._id === oid)

  it('库存仍在：closed 单重抢库存成功 → 复活 paid 且扣减库存', async () => {
    control.seed('inventory', [{ _id: 'k1__红', productId: 'k1', spec: '红', stock: 2 }])
    control.seed('orders', [
      { _id: 'k1o', id: 'k1o', status: 'closed', amount: 50, closedAt: 1, reserved: [{ productId: 'k1', spec: '红', qty: 1 }] },
    ])
    await main({ ...NOTIFY, outTradeNo: 'k1o', totalFee: 5000, transactionId: 'tx-revive' })
    const o = find('k1o')
    expect(o.status).toBe('paid')
    expect(o.transactionId).toBe('tx-revive')
    expect(inv('k1__红').stock).toBe(1) // 重抢扣回 1
  })

  it('库存已被买走：closed 单重抢失败 → 不超卖·进 refund_required 待退款（钱已收·人工退款）', async () => {
    control.seed('inventory', [{ _id: 'k2__红', productId: 'k2', spec: '红', stock: 0 }])
    control.seed('orders', [
      { _id: 'k2o', id: 'k2o', status: 'closed', amount: 50, closedAt: 1, reserved: [{ productId: 'k2', spec: '红', qty: 1 }] },
    ])
    await main({ ...NOTIFY, outTradeNo: 'k2o', totalFee: 5000, transactionId: 'tx-oos' })
    const o = find('k2o')
    expect(o.status).toBe('refund_required') // 没翻 paid（不超卖）
    expect(o.paidAt).toBeUndefined()
    expect(o.feeReceivedAt).toBeGreaterThan(0)
    expect(inv('k2__红').stock).toBe(0) // 库存没被扣穿（不足·宁缺勿超卖）
  })

  it('reserved 为空（不限量/无实物）：closed 单直接复活 paid', async () => {
    control.seed('orders', [{ _id: 'k3o', id: 'k3o', status: 'closed', amount: 50, closedAt: 1, reserved: [] }])
    await main({ ...NOTIFY, outTradeNo: 'k3o', totalFee: 5000, transactionId: 'tx-unlimited' })
    expect(find('k3o').status).toBe('paid')
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

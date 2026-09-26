// 变异分诊：callbacks/payCallback.ts 存活变异的杀手测试（旧版 v2 字段、非成功回调、各终态幂等不告警、
// 并发没抢到不告警、告警落进异常账本的级别/函数名/订单号、重抢库存的默认重试节奏）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import cloud, { control } from 'wx-server-sdk'
import { main as payCallback, reserveWithRetry } from '../src/functions/callbacks/payCallback'

const order = (over: Record<string, unknown> = {}) => ({
  _id: 'o1',
  amount: 100,
  status: 'pending',
  reserved: [{ productId: 'p1', spec: '', qty: 1 }],
  createdAt: 1,
  ...over,
})
const payEvent = (over: Record<string, unknown> = {}) => ({
  out_trade_no: 'o1',
  trade_state: 'SUCCESS',
  transaction_id: 'txn-1',
  amount: { payer_total: 10000, total: 10000 },
  ...over,
})
// vitest 的 rejects.toThrow('X') 遇到 false/undefined 这种假值拒因会直接放过，这里先取出拒因再断言
const rejectionOf = (p: Promise<unknown>) => p.then(() => 'RESOLVED', (e: unknown) => e)
const theOrder = () => control.dump('orders').find((d: any) => d._id === 'o1')
const anomalies = () => control.dump('anomalies').map((a: any) => ({ kind: a.kind, code: a.code, ctx: a.ctx }))
// 模拟并发方在本次写之前抢先改了单（内层写的 status 不是被拦的那个，不会再次触发）
const racePatchBefore = (targetStatus: string, patch: Record<string, unknown>) =>
  control.setBeforeUpdate(async ({ coll, data }: any) => {
    if (coll === 'orders' && data.status === targetStatus)
      await cloud.database().collection('orders').doc('o1').update({ data: patch })
  })

beforeEach(() => {
  control.reset()
  control.setOpenId('')
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('reserveWithRetry 默认节奏', () => {
  it('不传参数：最多抢 3 次，每次失败后等满 200ms 才再抢', async () => {
    vi.useFakeTimers()
    const reserve = vi.fn(async () => ({ ok: false, reserved: [] }))
    const done = reserveWithRetry(reserve)
    await vi.advanceTimersByTimeAsync(0)
    expect(reserve).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(199)
    expect(reserve).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(reserve).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(200)
    expect(reserve).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(1000)
    expect(reserve).toHaveBeenCalledTimes(3)
    expect((await done).ok).toBe(false)
  })
})

describe('回调入参', () => {
  it('旧版 v2 字段（无 amount 对象）：按 totalFee 核对、按 transactionId 记单号，正常转已付', async () => {
    control.seed('orders', [order()])
    await payCallback({ outTradeNo: 'o1', returnCode: 'SUCCESS', resultCode: 'SUCCESS', transactionId: 'txn-v2', totalFee: 10000 })
    const o = theOrder()
    expect(o.status).toBe('paid')
    expect(o.transactionId).toBe('txn-v2')
    expect(o.payerTotal).toBeNull()
    expect(o.feeMismatch).toBeUndefined()
  })

  it('没成功的回调不动单：v3 NOTPAY、v2 业务结果 FAIL 都留 pending', async () => {
    control.seed('orders', [order()])
    await payCallback(payEvent({ trade_state: 'NOTPAY' }))
    await payCallback({ outTradeNo: 'o1', returnCode: 'SUCCESS', resultCode: 'FAIL', transactionId: 't', totalFee: 10000 })
    expect(theOrder().status).toBe('pending')
  })

  it('v2 通信成功但业务失败、或通信失败业务成功：都不算付款成功', async () => {
    control.seed('orders', [order()])
    await payCallback({ outTradeNo: 'o1', returnCode: 'FAIL', resultCode: 'SUCCESS', transactionId: 't', totalFee: 10000 })
    expect(theOrder().status).toBe('pending')
  })

  it('amount 对象里没有 total：退回用 v2 的 totalFee 核对', async () => {
    control.seed('orders', [order()])
    await payCallback(payEvent({ amount: { payer_total: 10000 }, totalFee: 10000 }))
    expect(theOrder().status).toBe('paid')
  })

  it('读单失败（不是缺档）：告警后把原始错误抛出去（不 ACK）', async () => {
    control.seed('orders', [order()])
    control.setBeforeGet(async (a: any) => {
      if (a.coll === 'orders') throw new Error('NETWORK_TIMEOUT')
    })
    const e: any = await rejectionOf(payCallback(payEvent()))
    expect(e).toBeInstanceOf(Error)
    expect(e.message).toBe('NETWORK_TIMEOUT')
    expect(anomalies()).toEqual([{ kind: 'flow-failure', code: 'ORDER_READ_FAIL', ctx: { fn: 'payCallback', id: 'o1' } }])
  })

  it('回调里没有交易单号：落空串，不落占位文字', async () => {
    control.seed('orders', [order()])
    await payCallback(payEvent({ transaction_id: undefined }))
    expect(theOrder().transactionId).toBe('')
  })

  it('回调里没有商户单号：直接 ACK，不查单、不告警', async () => {
    control.seed('orders', [order()])
    expect(await payCallback(payEvent({ out_trade_no: undefined }))).toEqual({ errcode: 0, errmsg: 'OK' })
    expect(anomalies()).toEqual([])
    expect(theOrder().status).toBe('pending')
  })

  it('金额字段缺失（核对值为 NaN）：进异常态，方向记 unknown', async () => {
    control.seed('orders', [order()])
    await payCallback(payEvent({ amount: {} }))
    const o = theOrder()
    expect(o.status).toBe('payment_exception')
    expect(o.paymentMismatchDirection).toBe('unknown')
  })
})

describe('告警落进异常账本：级别=钱链、函数名、订单号都在', () => {
  it('查无此单 → UNKNOWN_ORDER', async () => {
    await payCallback(payEvent({ out_trade_no: 'ghost' }))
    expect(anomalies()).toEqual([{ kind: 'flow-failure', code: 'UNKNOWN_ORDER', ctx: { fn: 'payCallback', id: 'ghost' } }])
  })

  it('读到单后单被删：REREAD_FAIL 告警并抛错（不 ACK），错误信息带失败码', async () => {
    control.seed('orders', [order()])
    let reads = 0
    control.setBeforeGet(async (a: any) => {
      if (a.coll === 'orders' && a.id === 'o1' && ++reads === 2) await cloud.database().collection('orders').doc('o1').remove()
    })
    const e: any = await rejectionOf(payCallback(payEvent()))
    expect(e).toBeInstanceOf(Error)
    expect(e.message).toBe('PAYCB_REREAD_FAIL')
    expect(anomalies()).toEqual([{ kind: 'flow-failure', code: 'REREAD_FAIL', ctx: { fn: 'payCallback', id: 'o1' } }])
  })

  it('待支付单少付：进异常态；老单没有 reserved 也不报错；告警带实付/应付/方向', async () => {
    control.seed('orders', [order({ reserved: undefined })])
    await payCallback(payEvent({ amount: { total: 5000 } }))
    expect(theOrder().status).toBe('payment_exception')
    expect(anomalies()).toEqual([
      { kind: 'flow-failure', code: 'FEE_MISMATCH', ctx: { fn: 'payCallback', id: 'o1', paidFee: '5000', expectFen: '10000', direction: 'underpaid' } },
    ])
  })

  it('状态不认识 → UNEXPECTED_STATUS，带当前状态', async () => {
    control.seed('orders', [order({ status: 'weird' })])
    await payCallback(payEvent())
    expect(anomalies()).toEqual([{ kind: 'flow-failure', code: 'UNEXPECTED_STATUS', ctx: { fn: 'payCallback', id: 'o1', status: 'weird' } }])
  })
})

describe('重复回调落在各终态：不动单、不告警', () => {
  for (const status of ['shipped', 'done', 'refund_required', 'payment_exception']) {
    it(status, async () => {
      control.seed('orders', [order({ status })])
      await payCallback(payEvent())
      expect(theOrder().status).toBe(status)
      expect(anomalies()).toEqual([])
    })
  }
})

describe('关单后晚到的回调', () => {
  it('金额不符：进异常态并告警（带实付/应付/方向）', async () => {
    control.seed('orders', [order({ status: 'closed' })])
    await payCallback(payEvent({ amount: { total: 20000 } }))
    expect(theOrder().status).toBe('payment_exception')
    expect(anomalies()).toEqual([
      { kind: 'flow-failure', code: 'FEE_MISMATCH', ctx: { fn: 'payCallback', id: 'o1', paidFee: '20000', expectFen: '10000', direction: 'overpaid' } },
    ])
  })

  it('金额不符但并发方抢先改了状态：没转成就不告警', async () => {
    control.seed('orders', [order({ status: 'closed' })])
    racePatchBefore('payment_exception', { status: 'refund_required' })
    await payCallback(payEvent({ amount: { total: 20000 } }))
    expect(theOrder().status).toBe('refund_required')
    expect(anomalies()).toEqual([])
  })

  it('老单没有 reserved：不用抢库存，直接复活成已付', async () => {
    control.seed('orders', [order({ status: 'closed', reserved: undefined })])
    await payCallback(payEvent())
    expect(theOrder().status).toBe('paid')
  })

  it('复活写失败：还回刚抢的库存，告警码 REVIVE_FAIL 并抛错', async () => {
    control.seed('orders', [order({ status: 'closed' })])
    control.seed('inventory', [{ _id: 'p1__', productId: 'p1', spec: '', stock: 1 }])
    control.setBeforeUpdate(async ({ coll, data }: any) => {
      if (coll === 'orders' && data.status === 'paid') throw new Error('MOCK_WRITE_FAIL')
    })
    const e: any = await rejectionOf(payCallback(payEvent()))
    expect(e).toBeInstanceOf(Error)
    expect(e.message).toBe('MOCK_WRITE_FAIL')
    expect(control.dump('inventory')[0].stock).toBe(1)
    expect(anomalies()).toEqual([{ kind: 'flow-failure', code: 'REVIVE_FAIL', ctx: { fn: 'payCallback', id: 'o1' } }])
  })

  it('库存被买走：转待退款并告警（带交易单号与实付）', async () => {
    control.seed('orders', [order({ status: 'closed' })])
    control.seed('inventory', [{ _id: 'p1__', productId: 'p1', spec: '', stock: 0 }])
    await payCallback(payEvent())
    expect(theOrder().status).toBe('refund_required')
    expect(anomalies()).toEqual([
      { kind: 'flow-failure', code: 'PAID_BUT_OOS', ctx: { fn: 'payCallback', id: 'o1', transactionId: 'txn-1', paidFee: '10000' } },
    ])
  })

  it('库存被买走但并发方抢先改了状态：没转成就不告警', async () => {
    control.seed('orders', [order({ status: 'closed' })])
    control.seed('inventory', [{ _id: 'p1__', productId: 'p1', spec: '', stock: 0 }])
    racePatchBefore('refund_required', { status: 'paid' })
    await payCallback(payEvent())
    expect(theOrder().status).toBe('paid')
    expect(anomalies()).toEqual([])
  })
})

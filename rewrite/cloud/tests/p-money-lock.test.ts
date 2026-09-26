// 钱链降复杂度前的行为锁：补上 createOrder / shipOne / overrideRefund / approveRefund / payCallback /
// adminApi 网关此前没被测到的分支，并记下每条主路径的写库次数与顺序（拆函数时最容易悄悄改掉的东西）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as app } from '../src/functions/app/index'
import { main as adminApi } from '../src/functions/adminApi/index'
import { sha } from '../src/functions/adminApi/lib'
import { main as payCallback } from '../src/functions/callbacks/payCallback'
import { hash53 } from '../src/kit'

// 只记关心的集合，按发生顺序：add/update/remove + 外呼工作流
const trace = (colls: string[]) => {
  const log: string[] = []
  const hit = (op: string) => async ({ coll }: any) => {
    if (colls.includes(coll)) log.push(op + ':' + coll)
  }
  control.setBeforeAdd(hit('add'))
  control.setBeforeUpdate(hit('update'))
  control.setBeforeRemove(hit('remove'))
  control.setCallFunctionImpl(async () => {
    log.push('callFlow')
  })
  return log
}
const alertLines = () => {
  const lines: string[] = []
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
    lines.push(String(a[0]))
  })
  return lines
}
// 并发方直接改库（绕过写钩子，免得递归触发自己）
const store = (coll: string): any[] => (globalThis as any).__cloudMock.store[coll]
const anomaly = (code: string) => control.dump('anomalies').some((a: any) => a.code === code)

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.ALLOW_MOCK_PAY
})

describe('createOrder 行为锁', () => {
  const ADDR = { name: '张三', phone: '13800000000', region: '浙江·杭州', detail: 'xx 路 1 号' }
  const call = (data: Record<string, unknown>) => app({ action: 'createOrder', data }) as Promise<any>
  const claimIdOf = (key: string) => 'oi_' + hash53('oME|' + key)

  beforeEach(() => {
    control.reset()
    control.setOpenId('oME')
    control.seed('products', [{ _id: 'p1', id: 'p1', name: '小鸭礼盒', price: 198, tag: '基础款' }])
    control.seed('inventory', [{ _id: 'p1__基础款', productId: 'p1', spec: '基础款', stock: 5 }])
    control.seed('config', [{ _id: 'pay', mode: 'real', flowId: 'flow-pay' }])
  })

  it('大白话：条目超过行数上限整单拒 TOO_MANY_ITEMS，不建单不扣库存', async () => {
    const items = Array.from({ length: 101 }, () => ({ id: 'p1', qty: 1 }))
    expect((await call({ items, address: ADDR })).error).toBe('TOO_MANY_ITEMS')
    expect(control.dump('orders')).toEqual([])
    expect(control.dump('inventory')[0].stock).toBe(5)
  })

  it('大白话：带幂等键的成功下单——写库顺序：占幂等键 → 扣库存 → 建单 → 回填单号', async () => {
    const log = trace(['orderIdempotency', 'inventory', 'orders'])
    const r = await call({ items: [{ id: 'p1', qty: 2 }], address: ADDR, idempotencyKey: 'k-ok' })
    expect(r.ok).toBe(true)
    expect(r.order.status).toBe('pending')
    expect(r.order.reserved).toEqual([{ productId: 'p1', spec: '基础款', qty: 2 }])
    expect(log).toEqual(['add:orderIdempotency', 'update:inventory', 'add:orders', 'update:orderIdempotency'])
    expect(control.dump('orderIdempotency')[0].orderId).toBe(r.order.id)
  })

  it('大白话：同键在途、原请求一直没落定单号——轮询 5 次后回 PENDING，不建单不扣库存', async () => {
    control.seed('orderIdempotency', [{ _id: claimIdOf('k-busy'), openid: 'oME', orderId: null, createdAt: 1 }])
    let polls = 0
    control.setBeforeGet(async (a: any) => {
      if (a.coll === 'orderIdempotency' && a.id) polls++
    })
    const r = await call({ items: [{ id: 'p1', qty: 1 }], address: ADDR, idempotencyKey: 'k-busy' })
    expect(r.error).toBe('ORDER_CLAIM_PENDING')
    expect(polls).toBe(5)
    expect(control.dump('orders')).toEqual([])
    expect(control.dump('inventory')[0].stock).toBe(5)
  })

  it('大白话：同键登记了单号却读不到那张单——立刻按未落定报 PENDING，不再空等', async () => {
    control.seed('orderIdempotency', [{ _id: claimIdOf('k-lost'), openid: 'oME', orderId: 'ghost', createdAt: 1 }])
    let polls = 0
    control.setBeforeGet(async (a: any) => {
      if (a.coll === 'orderIdempotency' && a.id) polls++
    })
    const r = await call({ items: [{ id: 'p1', qty: 1 }], address: ADDR, idempotencyKey: 'k-lost' })
    expect(r.error).toBe('ORDER_CLAIM_PENDING')
    expect(polls).toBe(1)
    expect(control.dump('orders')).toEqual([])
  })

  it('大白话：回填幂等键单号失败——单照常建成返回，但留 CLAIM_UPDATE_FAIL 告警', async () => {
    const lines = alertLines()
    control.setBeforeUpdate(async ({ coll }: any) => {
      if (coll === 'orderIdempotency') throw new Error('MOCK_WRITE_FAIL')
    })
    const r = await call({ items: [{ id: 'p1', qty: 1 }], address: ADDR, idempotencyKey: 'k-fill' })
    expect(r.ok).toBe(true)
    expect(control.dump('orders').length).toBe(1)
    expect(control.dump('orderIdempotency')[0].orderId).toBeNull()
    expect(lines.some((l) => l.includes('code=CLAIM_UPDATE_FAIL'))).toBe(true)
  })

  it('大白话：订单号连撞 5 次都确认没落库——预留还回去、放掉幂等键、回 ORDER_ID_BUSY', async () => {
    const log = trace(['orderIdempotency', 'inventory', 'orders'])
    control.setBeforeAdd(async ({ coll }: any) => {
      if (coll === 'orderIdempotency' || coll === 'orders') log.push('add:' + coll)
      if (coll === 'orders') throw new Error('DUPLICATE_ID')
    })
    const r = await call({ items: [{ id: 'p1', qty: 2 }], address: ADDR, idempotencyKey: 'k-busy-id' })
    expect(r.error).toBe('ORDER_ID_BUSY')
    expect(control.dump('orders')).toEqual([])
    expect(control.dump('inventory')[0].stock).toBe(5)
    expect(control.dump('orderIdempotency')).toEqual([])
    expect(log).toEqual([
      'add:orderIdempotency',
      'update:inventory',
      'add:orders',
      'add:orders',
      'add:orders',
      'add:orders',
      'add:orders',
      'update:inventory',
      'remove:orderIdempotency',
    ])
  })

  it('大白话：mock 支付模式建单即已付、带 paidAt；在途单上限只在 real 模式查', async () => {
    control.reset()
    control.setOpenId('oME')
    process.env.ALLOW_MOCK_PAY = '1'
    control.seed('products', [{ _id: 'p1', id: 'p1', name: '小鸭礼盒', price: 198, tag: '基础款' }])
    let counted = 0
    control.setBeforeCount(async ({ coll }: any) => {
      if (coll === 'orders') counted++
    })
    const r = await call({ items: [{ id: 'p1', qty: 1 }], address: ADDR })
    expect(r.order.status).toBe('paid')
    expect(r.order.paidAt).toBe(r.order.createdAt)
    expect(counted).toBe(0)
  })
})

describe('adminApi 行为锁（shipOne / 退款 / 网关）', () => {
  const post = (action: string, data: Record<string, unknown> = {}) =>
    adminApi({
      httpMethod: 'POST',
      headers: { 'x-forwarded-for': '1.1.1.1' },
      body: JSON.stringify({ action, key: 'super-secret-key', data }),
    }).then((r: any) => ({ status: r.statusCode, ...JSON.parse(r.body) }))
  const seedOrder = (over: Record<string, unknown> = {}) =>
    control.seed('orders', [
      {
        _id: 'o1',
        id: 'o1',
        _openid: 'oBUYER',
        status: 'paid',
        amount: 396,
        goods: 396,
        transactionId: 'wx-t1',
        createdAt: 1000,
        items: [{ productId: 'p1', lineId: 'p1__红', spec: '红', name: '鸭', price: 198, qty: 2, enteredQty: 0, refundable: true }],
        ...over,
      },
    ])
  const seedFlow = () => control.seed('config', [{ _id: 'pay', mode: 'real', refundFlowId: 'flow-refund' }])
  const flowAccepts = () => control.setCallFunctionResult({ result: { data: { status: 'PROCESSING', refund_id: 'r1' } } })

  beforeEach(() => {
    control.reset()
    control.setOpenId('')
    control.seed('adminConfig', [{ _id: 'auth', keyHash: sha('super-secret-key'), role: 'superadmin', name: '店主' }])
  })

  it('大白话：首次发货写库顺序——条件翻已发货并上锁 → 核销流水 → 释放锁', async () => {
    seedOrder()
    const log = trace(['orders', 'stockLedger'])
    const r = await post('shipOrder', { id: 'o1', company: '顺丰', trackingNo: 'SF1', ackRefundedQty: {} })
    expect(r.ok).toBe(true)
    expect(r.wxShip).toBe(true)
    expect(r.refundedQty).toEqual({})
    expect(log).toEqual(['update:orders', 'add:stockLedger', 'update:orders'])
    const o = control.dump('orders')[0]
    expect(o.shipUploadLock).toBe('idle')
    expect(o.wxShipUploaded).toBe(true)
  })

  it('大白话：发货条件写没命中、回读发现单已被确认收货——回 BAD_STATUS:done，不上传不留痕', async () => {
    seedOrder()
    let flipped = false
    control.setBeforeUpdate(async ({ coll }: any) => {
      if (coll === 'orders' && !flipped) {
        flipped = true
        store('orders')[0].status = 'done'
      }
    })
    const r = await post('shipOrder', { id: 'o1', company: '顺丰', trackingNo: 'SF1', ackRefundedQty: {} })
    expect(r.error).toBe('BAD_STATUS:done')
    expect(control.openapiCalls().length).toBe(0)
    expect(control.dump('stockLedger')).toEqual([])
  })

  it('大白话：条件写没命中且回读也失败——按 BAD_STATUS:unknown 拒', async () => {
    seedOrder({ shipUploadLock: 'busy', shipUploadLockAt: Date.now() })
    let reads = 0
    control.setBeforeGet(async (a: any) => {
      if (a.coll === 'orders' && a.id && ++reads === 2) throw new Error('MOCK_READ_FAIL')
    })
    const r = await post('shipOrder', { id: 'o1', company: '顺丰', trackingNo: 'SF1', ackRefundedQty: {} })
    expect(r.error).toBe('BAD_STATUS:unknown')
  })

  it('大白话：陈旧锁抢占写也没命中（别人刚抢到新锁）——回 SHIP_IN_PROGRESS，不告警不上传', async () => {
    const staleAt = Date.now() - 6 * 60 * 1000
    seedOrder({ shipUploadLock: 'busy', shipUploadLockAt: staleAt })
    let updates = 0
    control.setBeforeUpdate(async ({ coll }: any) => {
      if (coll === 'orders' && ++updates === 2) store('orders')[0].shipUploadLockAt = Date.now()
    })
    const r = await post('shipOrder', { id: 'o1', company: '顺丰', trackingNo: 'SF1', ackRefundedQty: {} })
    expect(r.error).toBe('SHIP_IN_PROGRESS')
    expect(anomaly('SHIP_LOCK_STALE_PREEMPTED')).toBe(false)
    expect(control.openapiCalls().length).toBe(0)
  })

  it('大白话：核销留痕失败不反噬发货——照常发货，留 SCM_LEDGER_FAIL 告警', async () => {
    seedOrder()
    control.setBeforeAdd(async ({ coll }: any) => {
      if (coll === 'stockLedger') throw new Error('MOCK_WRITE_FAIL')
    })
    const r = await post('shipOrder', { id: 'o1', company: '顺丰', trackingNo: 'SF1', ackRefundedQty: {} })
    expect(r.ok).toBe(true)
    expect(control.dump('orders')[0].status).toBe('shipped')
    expect(anomaly('SCM_LEDGER_FAIL')).toBe(true)
  })

  it('大白话：部分退款后首次发货——只核销没退的件，发货人确认的已退件数对上才放行', async () => {
    seedOrder()
    control.seed('afterSales', [
      { _id: 'o1__p1__红', orderId: 'o1', lineId: 'p1__红', productId: 'p1', status: 'refunded', qty: 1, refundAmount: 198 },
    ])
    expect((await post('shipOrder', { id: 'o1', company: '顺丰', trackingNo: 'SF1', ackRefundedQty: {} })).error).toBe(
      'REFUND_LINES_CHANGED'
    )
    const r = await post('shipOrder', { id: 'o1', company: '顺丰', trackingNo: 'SF1', ackRefundedQty: { 'p1__红': 1 } })
    expect(r.ok).toBe(true)
    expect(r.refundedQty).toEqual({ 'p1__红': 1 })
    expect(control.dump('stockLedger')[0].delta).toBe(-1)
  })

  it('大白话：越规退款缺原因/行不存在都拒，不建售后不外呼', async () => {
    seedOrder()
    seedFlow()
    expect((await post('overrideRefund', { orderId: 'o1', lineId: 'p1__红' })).error).toBe('BAD_ARGS')
    expect((await post('overrideRefund', { orderId: 'o1', lineId: 'nope', reason: '质量问题' })).error).toBe('UNKNOWN_ITEM')
    expect(control.dump('afterSales')).toEqual([])
    expect(control.callFunctionCalls()).toEqual([])
  })

  it('大白话：越规退款成功写库顺序——先建已批准售后单，再外呼退款；金额按行封顶', async () => {
    seedOrder()
    seedFlow()
    flowAccepts()
    const log = trace(['afterSales', 'orders'])
    const r = await post('overrideRefund', { orderId: 'o1', lineId: 'p1__红', reason: '质量问题' })
    expect(r).toMatchObject({ status: 200, ok: true, id: 'o1__p1__红' })
    expect(log).toEqual(['add:afterSales', 'callFlow'])
    const as = control.dump('afterSales')[0]
    expect(as).toMatchObject({ status: 'approved', overridden: true, qty: 2, refundAmount: 396, itemTotal: 396 })
    expect(control.callFunctionCalls()[0].data.data.amount).toEqual({ refund: 39600, total: 39600, currency: 'CNY' })
  })

  it('大白话：同意退款缺 id 拒 BAD_ARGS；申请后又进课、按当下重算已无余额——拒 NOTHING_LEFT 且不抢占', async () => {
    expect((await post('approveRefund', {})).error).toBe('BAD_ARGS')
    seedOrder({
      amount: 396,
      goods: 396,
      items: [{ productId: 'p1', lineId: 'p1__红', spec: '红', name: '鸭', price: 198, qty: 2, enteredQty: 1, refundable: true }],
    })
    seedFlow()
    control.seed('afterSales', [
      { _id: 'as1', orderId: 'o1', lineId: 'p1__红', productId: 'p1', qty: 2, refundAmount: 396, status: 'applied', appliedAt: 1 },
      { _id: 'as-other', orderId: 'o1', lineId: 'p9', productId: 'p9', qty: 1, refundAmount: 396, status: 'refunded', appliedAt: 1 },
    ])
    const r = await post('approveRefund', { id: 'as1' })
    expect(r.error).toBe('NOTHING_LEFT')
    expect(control.dump('afterSales').find((a: any) => a._id === 'as1').status).toBe('applied')
    expect(control.callFunctionCalls()).toEqual([])
  })

  it('大白话：同意退款成功写库顺序——条件抢占（连同降级字段一次写）→ 外呼退款；订单实付作 total', async () => {
    seedOrder({
      items: [{ productId: 'p1', lineId: 'p1__红', spec: '红', name: '鸭', price: 198, qty: 2, enteredQty: 1, refundable: true }],
    })
    seedFlow()
    flowAccepts()
    control.seed('afterSales', [
      { _id: 'as1', orderId: 'o1', lineId: 'p1__红', productId: 'p1', qty: 2, refundAmount: 396, status: 'applied', appliedAt: 1, reason: '不想要' },
    ])
    const log = trace(['afterSales', 'orders'])
    const r = await post('approveRefund', { id: 'as1' })
    expect(r.ok).toBe(true)
    expect(log).toEqual(['update:afterSales', 'callFlow'])
    const as = control.dump('afterSales')[0]
    expect(as).toMatchObject({ status: 'approved', qty: 1, refundAmount: 198, itemTotal: 198, outRefundNo: 'as1' })
    expect(control.callFunctionCalls()[0].data.data).toMatchObject({
      out_trade_no: 'o1',
      out_refund_no: 'as1',
      reason: '不想要',
      amount: { refund: 19800, total: 39600, currency: 'CNY' },
    })
  })

  it('大白话：退款工作流回了空结果（没 status/refund_id/out_refund_no）——当未受理：告警、回滚成可重试、回 500', async () => {
    seedOrder()
    seedFlow()
    control.setCallFunctionResult({ result: { data: {} } })
    control.seed('afterSales', [
      { _id: 'as1', orderId: 'o1', lineId: 'p1__红', productId: 'p1', qty: 2, refundAmount: 396, status: 'applied', appliedAt: 1 },
    ])
    expect(await post('approveRefund', { id: 'as1' })).toMatchObject({ status: 500, error: 'REFUND_TRIGGER_FAIL' })
    expect(control.dump('afterSales')[0].status).toBe('applied')
    seedOrder({ _id: 'o2', id: 'o2' })
    expect(await post('overrideRefund', { orderId: 'o2', lineId: 'p1__红', reason: '质量问题' })).toMatchObject({
      status: 500,
      error: 'REFUND_TRIGGER_FAIL',
    })
    expect(control.dump('afterSales').find((a: any) => a.orderId === 'o2').status).toBe('applied')
    expect(control.dump('anomalies').filter((a: any) => a.code === 'REFUND_TRIGGER_FAIL').length).toBeGreaterThanOrEqual(1)
  })

  it('大白话：口令登录成功清掉本 IP 之前的失败计数', async () => {
    const login = (key: string) =>
      adminApi({ httpMethod: 'POST', headers: { 'x-forwarded-for': '9.9.9.9' }, body: JSON.stringify({ action: 'login', key }) })
    const fails = () => (control.dump('rateLimit').find((r: any) => r._id === 'rl_adminlogin:9.9.9.9') || {}).fails
    await login('wrong-long-key')
    expect(fails()).toBe(1)
    const ok: any = await login('super-secret-key')
    expect(ok.statusCode).toBe(200)
    expect(fails()).toBe(0)
  })

  it('大白话：企微免登查无绑定账号（403）算一次鉴权失败，计入本 IP 频控', async () => {
    control.seed('kfState', [{ _id: 'token', accessToken: 'TKN', expireAt: Date.now() + 3600_000 }])
    vi.stubGlobal('fetch', async (url: any) => ({
      json: async () => (String(url).includes('auth/getuserinfo') ? { errcode: 0, userid: 'nobody' } : { errcode: 0 }),
    }))
    const r: any = await adminApi({
      httpMethod: 'POST',
      headers: { 'x-forwarded-for': '9.9.9.8' },
      body: JSON.stringify({ action: 'loginByWecomCode', data: { code: 'c' } }),
    })
    vi.unstubAllGlobals()
    expect(r.statusCode).toBe(403)
    expect(control.dump('rateLimit').find((x: any) => x._id === 'rl_adminlogin:9.9.9.8').fails).toBe(1)
  })

  it('大白话：网关收 base64 包体照常解析；坏 JSON 回 BAD_JSON；非 POST 拒', async () => {
    const body = Buffer.from(JSON.stringify({ action: 'ping' })).toString('base64')
    const r: any = await adminApi({ httpMethod: 'POST', headers: {}, isBase64Encoded: true, body })
    expect(r.statusCode).toBe(200)
    expect(JSON.parse(r.body).ok).toBe(true)
    const bad: any = await adminApi({ httpMethod: 'POST', headers: {}, body: '{' })
    expect(JSON.parse(bad.body).error).toBe('BAD_JSON')
    const get: any = await adminApi({ httpMethod: 'GET', headers: {} })
    expect(get.statusCode).toBe(405)
  })
})

describe('payCallback 行为锁', () => {
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
    amount: { payer_total: 9000, total: 10000 },
    ...over,
  })

  beforeEach(() => {
    control.reset()
    control.setOpenId('')
  })

  it('大白话：订单处在状态机外的怪状态——告警 UNEXPECTED_STATUS，不改单', async () => {
    control.seed('orders', [order({ status: 'weird' })])
    await payCallback(payEvent())
    expect(anomaly('UNEXPECTED_STATUS')).toBe(true)
    expect(control.dump('orders')[0].paidAt).toBeUndefined()
  })

  it('大白话：首读看到单、流转前再读却没了——告警 REREAD_FAIL 并抛错不 ACK', async () => {
    control.seed('orders', [order()])
    let reads = 0
    control.setBeforeGet(async (a: any) => {
      if (a.coll === 'orders' && a.id && ++reads === 2) throw new Error('DOCUMENT_NOT_FOUND')
    })
    await expect(payCallback(payEvent())).rejects.toThrow('PAYCB_REREAD_FAIL')
    expect(anomaly('REREAD_FAIL')).toBe(true)
  })

  it('大白话：关单复活时别的回调已抢先复活——把刚抢的库存还回去，不双扣', async () => {
    control.seed('orders', [order({ status: 'closed' })])
    control.seed('inventory', [{ _id: 'p1__', productId: 'p1', spec: '', stock: 3 }])
    control.setBeforeUpdate(async ({ coll, data }: any) => {
      if (coll === 'orders' && data.status === 'paid') store('orders')[0].status = 'paid'
    })
    await payCallback(payEvent())
    expect(control.dump('inventory')[0].stock).toBe(3)
    const o = control.dump('orders')[0]
    expect(o.status).toBe('paid')
    expect(o.revivedAt).toBeUndefined()
  })

  it('大白话：正常支付只核对原单总额 total，用户实付 payer_total 只存档（分）', async () => {
    control.seed('orders', [order()])
    const log = trace(['orders', 'inventory'])
    await payCallback(payEvent())
    expect(log).toEqual(['update:orders'])
    const o = control.dump('orders')[0]
    expect(o).toMatchObject({ status: 'paid', transactionId: 'txn-1', payerTotal: 9000 })
    expect(o.feeMismatch).toBeUndefined()
  })
})

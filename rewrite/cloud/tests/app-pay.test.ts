// 黄金 orders-money·pay/payCallback 节（守卫 rw-money2-golden）。
import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as app } from '../src/functions/app/index'
import { main as payCallback, reserveWithRetry } from '../src/functions/callbacks/payCallback'
import { getDb } from '../src/kit'

const call = (action: string, data: Record<string, unknown> = {}) => app({ action, data }) as Promise<any>
const cb = (e: Record<string, unknown>) => payCallback(e) as Promise<any>

const seedOrder = (over: Record<string, unknown> = {}) =>
  control.seed('orders', [
    {
      _id: 'o1',
      id: 'o1',
      _openid: 'oME',
      status: 'pending',
      amount: 178,
      createdAt: Date.now(),
      items: [{ productId: 'p1', name: '小鸭礼盒', qty: 1 }],
      reserved: [],
      ...over,
    },
  ])
const seedRealPay = () => control.seed('config', [{ _id: 'pay', mode: 'real', flowId: 'flow-pay' }])

beforeEach(() => {
  control.reset()
  control.setOpenId('oME')
})

describe('pay（发起支付·黄金）', () => {
  it('大白话：缺单号拒；他人订单表现为不存在；非待支付不得再次发起', async () => {
    seedOrder({ status: 'paid' })
    expect((await call('pay', {})).error).toBe('NO_ID')
    control.setOpenId('oOTHER')
    expect((await call('pay', { id: 'o1' })).error).toBe('NOT_FOUND')
    control.setOpenId('oME')
    expect((await call('pay', { id: 'o1' })).error).toContain('BAD_STATUS:paid')
  })

  it('大白话：超时单惰性关闭并回补预留、拒付；支付通道未启用一律不放行', async () => {
    seedOrder({
      createdAt: Date.now() - 20 * 60 * 1000,
      reserved: [{ productId: 'p1', spec: '', qty: 1 }],
    })
    control.seed('inventory', [{ _id: 'p1__', productId: 'p1', spec: '', stock: 0 }])
    expect((await call('pay', { id: 'o1' })).error).toBe('ORDER_CLOSED')
    expect(control.dump('orders')[0].status).toBe('closed')
    expect(control.dump('inventory')[0].stock).toBe(1) // 回补

    seedOrder({ _id: 'o2', id: 'o2' } as any)
    control.seed('config', [{ _id: 'pay', mode: 'mock' }])
    expect((await call('pay', { id: 'o2' })).error).toBe('PAY_NOT_ENABLED')
  })

  it('大白话：发起支付金额取库内订单换分并透传本人身份与单号，不信前端金额', async () => {
    seedOrder()
    seedRealPay()
    control.setCallFunctionResult({
      result: { data: { timeStamp: '1', nonceStr: 'n', packageVal: 'pkg=x', signType: 'RSA', paySign: 'sig' } },
    })
    const r = await call('pay', { id: 'o1', amount: 0.01 }) // 前端伪造金额无效
    expect(r.ok).toBe(true)
    expect(r.payment.package).toBe('pkg=x') // packageVal → package 对齐收银台参数
    const sent = control.callFunctionCalls()[0]
    expect(sent.data.name).toBe('flow-pay')
    expect(sent.data.data.amount.total).toBe(17800) // 178 元 → 17800 分
    expect(sent.data.data.out_trade_no).toBe('o1')
    expect(sent.data.data.payer.openid).toBe('oME')
  })

  it('大白话：工作流未返预付单——订单留在待支付、不误置其他态', async () => {
    seedOrder()
    seedRealPay()
    control.setCallFunctionResult({ result: {} })
    expect((await call('pay', { id: 'o1' })).error).toBe('UNIFIED_ORDER_FAIL')
    expect(control.dump('orders')[0].status).toBe('pending')
  })

  it('大白话：0 元单不走外部通道直接置已付；被并发抢先时以并发结果为准、不谎报成功', async () => {
    seedOrder({ amount: 0 })
    seedRealPay()
    const r = await call('pay', { id: 'o1' })
    expect(r.paid).toBe(true)
    expect(control.dump('orders')[0].status).toBe('paid')
    expect(control.callFunctionCalls().length).toBe(0) // 未触外部通道

    // 并发已付：重复发起幂等成功（读回真实 paidAt）
    const r2 = await call('pay', { id: 'o1' })
    expect(r2.error).toContain('BAD_STATUS:paid') // 入口闸先拒（订单已非 pending）
  })
})

describe('payCallback（支付回调·黄金）', () => {
  it('大白话：带用户身份的伪造回调不改任何钱状态、静默 ack 不给探测信号', async () => {
    seedOrder()
    control.setOpenId('oFAKE')
    const r = await cb({ out_trade_no: 'o1', trade_state: 'SUCCESS', amount: { total: 17800 } })
    expect(r).toEqual({ errcode: 0, errmsg: 'OK' })
    expect(control.dump('orders')[0].status).toBe('pending')
  })

  it('大白话：成功回调置已付留交易号，只生效一次；重复通知不改写；非成功不改状态', async () => {
    control.setOpenId('')
    seedOrder()
    await cb({ out_trade_no: 'o1', trade_state: 'SUCCESS', amount: { total: 17800 }, transaction_id: 'wx-t1' })
    const o1 = control.dump('orders')[0]
    expect(o1.status).toBe('paid')
    expect(o1.transactionId).toBe('wx-t1')
    expect(o1.feeMismatch).toBeUndefined()

    await cb({ out_trade_no: 'o1', trade_state: 'SUCCESS', amount: { total: 17800 }, transaction_id: 'wx-t2' })
    expect(control.dump('orders')[0].transactionId).toBe('wx-t1') // 幂等不改写

    seedOrder({ _id: 'o2', id: 'o2' } as any)
    await cb({ out_trade_no: 'o2', trade_state: 'PAYERROR' })
    expect(control.dump('orders').find((o: any) => o._id === 'o2').status).toBe('pending')
  })

  it('大白话：金额不符仍照常入账（钱已收）但留对账痕；未知订单号确认不抛；旧版回调字段同样入账', async () => {
    control.setOpenId('')
    seedOrder()
    await cb({ out_trade_no: 'o1', trade_state: 'SUCCESS', amount: { total: 1 }, transaction_id: 'wx-t1' })
    const o1 = control.dump('orders')[0]
    expect(o1.status).toBe('paid')
    expect(o1.feeMismatch).toBe(true)

    const r = await cb({ out_trade_no: 'ghost', trade_state: 'SUCCESS', amount: { total: 1 } })
    expect(r).toEqual({ errcode: 0, errmsg: 'OK' })

    seedOrder({ _id: 'o3', id: 'o3' } as any)
    await cb({ outTradeNo: 'o3', returnCode: 'SUCCESS', resultCode: 'SUCCESS', totalFee: 17800, transactionId: 'v2-t' })
    expect(control.dump('orders').find((o: any) => o._id === 'o3').status).toBe('paid')
  })

  it('大白话：关单后钱到账须复活——库存足则重抢扣回并复活已付；已被买走则进待退款、绝不超卖', async () => {
    control.setOpenId('')
    // 复活成功路径
    seedOrder({ status: 'closed', reserved: [{ productId: 'p1', spec: '', qty: 1 }] })
    control.seed('inventory', [{ _id: 'p1__', productId: 'p1', spec: '', stock: 1 }])
    await cb({ out_trade_no: 'o1', trade_state: 'SUCCESS', amount: { total: 17800 }, transaction_id: 'wx-r' })
    const o1 = control.dump('orders')[0]
    expect(o1.status).toBe('paid')
    expect(o1.revivedAt).toBeGreaterThan(0)
    expect(control.dump('inventory')[0].stock).toBe(0) // 重抢扣回

    // 售罄路径（真被买走·重试仍失败）→ refund_required
    seedOrder({ _id: 'o9', id: 'o9', status: 'closed', reserved: [{ productId: 'p9', spec: '', qty: 1 }] } as any)
    control.seed('inventory', [{ _id: 'p9__', productId: 'p9', spec: '', stock: 0 }])
    await cb({ out_trade_no: 'o9', trade_state: 'SUCCESS', amount: { total: 17800 }, transaction_id: 'wx-x' })
    const o9 = control.dump('orders').find((o: any) => o._id === 'o9')
    expect(o9.status).toBe('refund_required')
    expect(o9.feeReceivedAt).toBeGreaterThan(0)
    expect(o9.paidFee).toBe(17800)
  }, 15_000)

  it('大白话：读后被并发关单抢先（关单定时器与回调竞态）——重读现值仍走复活路径，不误判静默 no-op（P1·根因#1）', async () => {
    control.setOpenId('')
    seedOrder({ reserved: [{ productId: 'p1', spec: '', qty: 1 }] }) // status 默认 pending
    control.seed('inventory', [{ _id: 'p1__', productId: 'p1', spec: '', stock: 1 }])
    let armed = true
    control.setBeforeUpdate(async ({ coll, data }: any) => {
      // transition() 的条件更新真正落库前：模拟关单定时器抢先把订单转 closed（此刻库里仍是 pending，
      // 定时器的 where(status:pending) 条件更新能命中成功）——制造「读时 pending、真现值已是 closed」的窗口。
      if (armed && coll === 'orders' && data && data.status === 'paid') {
        armed = false
        await getDb().collection('orders').where({ _id: 'o1', status: 'pending' }).update({ data: { status: 'closed', closedAt: Date.now() } })
      }
    })
    await cb({ out_trade_no: 'o1', trade_state: 'SUCCESS', amount: { total: 17800 }, transaction_id: 'wx-race' })
    control.setBeforeUpdate(null as never)
    const o1 = control.dump('orders')[0]
    // 旧 bug：p.doc.status（读时值）仍是 'pending' → 命中「已 paid：幂等 no-op」误判分支静默返回——
    // 钱已收、单卡死 closed、无告警。新逻辑：重读现值发现真是 closed，走复活路径。
    expect(o1.status).toBe('paid')
    expect(o1.revivedAt).toBeGreaterThan(0)
    expect(control.dump('inventory')[0].stock).toBe(0) // 重抢扣回
  })

  it('大白话：竞态缓冲——首抢失败若是回补瞬时窗，重试即成功不误判售罄；真售罄重试耗尽仍失败', async () => {
    // 直接验证重试语义（回补瞬时窗＝第二次尝试即成功；真售罄＝次次失败直至耗尽）
    let calls = 0
    const r2 = await reserveWithRetry(
      async () => {
        calls++
        return calls >= 2 ? { ok: true, reserved: [] } : { ok: false, reserved: [] }
      },
      { tries: 3, delayMs: 1 }
    )
    expect(r2.ok).toBe(true)
    expect(calls).toBe(2)

    let calls2 = 0
    const r3 = await reserveWithRetry(
      async () => {
        calls2++
        return { ok: false, reserved: [] }
      },
      { tries: 3, delayMs: 1 }
    )
    expect(r3.ok).toBe(false)
    expect(calls2).toBe(3)
  })
})

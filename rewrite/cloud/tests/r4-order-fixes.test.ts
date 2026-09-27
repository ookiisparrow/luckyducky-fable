// #400 订单单元（R4-order）：付款后重复下单不误报、结算价变动拦截、读失败不冒充「不存在/未配置」、
// 发货回写与超时关单写失败不静默、下单条目 id 走 str()。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import cloud, { control } from 'wx-server-sdk'
import { COLLECTIONS } from '@ldrw/shared'
import { main as app } from '../src/functions/app/index'
import { main as adminApi } from '../src/functions/adminApi/index'
import { sha } from '../src/functions/adminApi/lib'
import { main as closeExpired } from '../src/functions/timers/closeExpiredOrders'

const call = (action: string, data: Record<string, unknown> = {}) => app({ action, data }) as Promise<any>
const SUPER = 'super-secret-key'
const admin = (action: string, data: Record<string, unknown> = {}) =>
  adminApi({
    httpMethod: 'POST',
    headers: { 'x-forwarded-for': '1.1.1.1' },
    body: JSON.stringify({ action, key: SUPER, data }),
  }).then((r: any) => ({ status: r.statusCode, ...JSON.parse(r.body) }))

const ADDR = { name: '张三', phone: '13800000000', region: '浙江·杭州', detail: 'xx 路 1 号' }
const readFail = (coll: string, id: string) =>
  control.setBeforeGet(async (a: any) => {
    if (a.coll === coll && a.id === id) throw new Error('NETWORK_TIMEOUT')
  })

// [LD_ALERT] 行：alert() 只落 console.error，notifyAlert 另进 anomalies
let alertLines: string[] = []
const alerted = (code: string) => alertLines.some((s) => s.includes('[LD_ALERT]') && s.includes(`code=${code} `))

beforeEach(() => {
  control.reset()
  control.setOpenId('oME')
  alertLines = []
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
    alertLines.push(String(a[0]))
  })
})
afterEach(() => {
  delete process.env.ALLOW_MOCK_PAY
  vi.restoreAllMocks()
})

describe('#400-33 付款后回调未到再点支付：回 ORDER_ALREADY_PAID、不发钱链告警', () => {
  const seedPending = () => {
    control.seed('orders', [
      { _id: 'o1', id: 'o1', _openid: 'oME', status: 'pending', amount: 178, createdAt: Date.now(), items: [{ productId: 'p1', name: '鸭', qty: 1 }], reserved: [] },
    ])
    control.seed('config', [{ _id: 'pay', mode: 'real', flowId: 'flow-pay' }])
  }

  // 下面两条的 ORDERPAID 回包形状是编的（仓里没有真机样本）：只锁「认得出就不告警」，证明不了真实工作流会回这个词。
  // #400-33 不能凭这两条关单，要等真机样本换掉这里，或改走查单拿已付信号。
  it('工作流回包带微信 ORDERPAID（无 data）：回 ORDER_ALREADY_PAID，FLOW_NO_DATA/NO_PREPAY 都不报，订单不动', async () => {
    seedPending()
    control.setCallFunctionResult({ result: { errCode: -1, errMsg: '{"code":"ORDERPAID","message":"该订单已支付"}' } })
    const r = await call('pay', { id: 'o1' })
    expect(r.error).toBe('ORDER_ALREADY_PAID')
    expect(alerted('FLOW_NO_DATA') || alerted('NO_PREPAY')).toBe(false)
    expect(control.dump('orders')[0].status).toBe('pending') // 翻已付只认回调
  })

  it('ORDERPAID 在 data 里或在抛错文案里，同样认', async () => {
    seedPending()
    control.setCallFunctionResult({ result: { data: { code: 'ORDERPAID', message: '该订单已支付' } } })
    expect((await call('pay', { id: 'o1' })).error).toBe('ORDER_ALREADY_PAID')
    control.setCallFunctionImpl(async () => {
      throw new Error('workflow failed: {"code":"ORDERPAID"}')
    })
    expect((await call('pay', { id: 'o1' })).error).toBe('ORDER_ALREADY_PAID')
    expect(alerted('FLOW_CALL_FAIL') || alerted('NO_PREPAY')).toBe(false)
  })

  it('下单途中回调先到、单已是收款态：回 ORDER_ALREADY_PAID，NO_PREPAY/FLOW_NO_DATA 都不报', async () => {
    seedPending()
    control.setCallFunctionImpl(async () => {
      await cloud.database().collection('orders').doc('o1').update({ data: { status: 'paid' } })
    })
    control.setCallFunctionResult({ result: {} })
    expect((await call('pay', { id: 'o1' })).error).toBe('ORDER_ALREADY_PAID')
    expect(alerted('NO_PREPAY') || alerted('FLOW_NO_DATA')).toBe(false)
  })

  it('下单调用抛错、但回调已先到：同样回 ORDER_ALREADY_PAID，不报 FLOW_CALL_FAIL', async () => {
    seedPending()
    control.setCallFunctionImpl(async () => {
      await cloud.database().collection('orders').doc('o1').update({ data: { status: 'paid' } })
      throw new Error('ESOCKETTIMEDOUT')
    })
    expect((await call('pay', { id: 'o1' })).error).toBe('ORDER_ALREADY_PAID')
    expect(alerted('NO_PREPAY') || alerted('FLOW_CALL_FAIL')).toBe(false)
  })

  it('真没拿到预付单（单仍待付、回包没有 ORDERPAID）：照旧报 UNIFIED_ORDER_FAIL，FLOW_NO_DATA 带回包摘要照报', async () => {
    seedPending()
    control.setCallFunctionResult({ result: { errMsg: 'SYSTEM_ERROR' } })
    expect((await call('pay', { id: 'o1' })).error).toBe('UNIFIED_ORDER_FAIL')
    expect(alerted('NO_PREPAY')).toBe(true)
    expect(alertLines.some((s) => s.includes('code=FLOW_NO_DATA ') && s.includes('SYSTEM_ERROR'))).toBe(true)
  })

  it('调用抛错且单仍待付：FLOW_CALL_FAIL 带报错摘要照报', async () => {
    seedPending()
    control.setCallFunctionImpl(async () => {
      throw new Error('ESOCKETTIMEDOUT')
    })
    expect((await call('pay', { id: 'o1' })).error).toBe('UNIFIED_ORDER_FAIL')
    expect(alertLines.some((s) => s.includes('code=FLOW_CALL_FAIL ') && s.includes('ESOCKETTIMEDOUT'))).toBe(true)
  })
})

describe('#400-34 下单带 expectedAmountFen：现价应付不符回 PRICE_CHANGED', () => {
  beforeEach(() => {
    process.env.ALLOW_MOCK_PAY = '1'
    control.seed('products', [{ _id: 'p1', id: 'p1', name: '小鸭礼盒', price: 198 }])
  })
  const order = (extra: Record<string, unknown>) => call('createOrder', { items: [{ id: 'p1', qty: 2 }, { id: 'hook', qty: 1 }], address: ADDR, ...extra })

  it('结算页金额和现价不符：拒单并带回现价应付分，不建单不扣库存', async () => {
    control.seed('inventory', [{ _id: 'p1__', productId: 'p1', spec: '', stock: 5 }])
    const r = await order({ expectedAmountFen: 19800 * 2 })
    expect(r.error).toBe('PRICE_CHANGED')
    expect(r.amountFen).toBe(19800 * 2 + 3900)
    expect(control.dump('orders').length).toBe(0)
    expect(control.dump('inventory')[0].stock).toBe(5)
  })

  it('金额一致照常建单；不传保持旧行为；传了却不是整数分回 BAD_ARGS', async () => {
    expect((await order({ expectedAmountFen: 19800 * 2 + 3900 })).ok).toBe(true)
    expect((await order({})).ok).toBe(true)
    expect((await order({ expectedAmountFen: '43500' })).error).toBe('BAD_ARGS')
    expect((await order({ expectedAmountFen: 435.5 })).error).toBe('BAD_ARGS')
  })

  it('同一幂等键：首单已建成后改价，带旧价重试回放原单（不回 PRICE_CHANGED）；新键核价不符拒单并放掉键', async () => {
    control.seed('inventory', [{ _id: 'p1__', productId: 'p1', spec: '', stock: 5 }])
    const oldFen = 19800 * 2 + 3900
    const first = await order({ expectedAmountFen: oldFen, idempotencyKey: 'k1' })
    expect(first.ok).toBe(true)
    await cloud.database().collection('products').doc('p1').update({ data: { price: 188 } }) // 首单回包丢了，期间后台改价
    const again = await order({ expectedAmountFen: oldFen, idempotencyKey: 'k1' })
    expect(again.ok).toBe(true)
    expect(again.order.id).toBe(first.order.id) // 用户付的是当初看到并提交的那张单
    const stale = await order({ expectedAmountFen: oldFen, idempotencyKey: 'k2' })
    expect(stale.error).toBe('PRICE_CHANGED')
    const fresh = await order({ expectedAmountFen: stale.amountFen, idempotencyKey: 'k2' }) // 小程序拒后不换键
    expect(fresh.ok).toBe(true)
    expect(fresh.order.id).not.toBe(first.order.id)
    expect(fresh.order.amount).toBe(stale.amountFen / 100)
    expect(control.dump('inventory')[0].stock).toBe(1)
  })
})

describe('#400-3 读失败回 DOC_READ_FAIL，不冒充「不存在/未配置」', () => {
  it('createOrder：支付配置读失败回 DOC_READ_FAIL；配置真没有才是 PAY_CONFIG_MISSING', async () => {
    control.seed('products', [{ _id: 'p1', id: 'p1', name: '小鸭礼盒', price: 198 }])
    const place = () => call('createOrder', { items: [{ id: 'p1', qty: 1 }], address: ADDR })
    expect((await place()).error).toBe('PAY_CONFIG_MISSING')
    control.seed('config', [{ _id: 'pay', mode: 'real' }])
    readFail('config', 'pay')
    expect((await place()).error).toBe('DOC_READ_FAIL')
    expect(control.dump('orders').length).toBe(0)
  })

  it('pay：支付配置读失败回 DOC_READ_FAIL；配置真没开才是 PAY_NOT_ENABLED', async () => {
    control.seed('orders', [{ _id: 'o1', id: 'o1', _openid: 'oME', status: 'pending', amount: 178, createdAt: Date.now(), reserved: [] }])
    expect((await call('pay', { id: 'o1' })).error).toBe('PAY_NOT_ENABLED')
    control.seed('config', [{ _id: 'pay', mode: 'real', flowId: 'flow-pay' }])
    readFail('config', 'pay')
    expect((await call('pay', { id: 'o1' })).error).toBe('DOC_READ_FAIL')
    expect(control.callFunctionCalls().length).toBe(0)
  })

  describe('后台订单动作', () => {
    beforeEach(() => {
      control.setOpenId('')
      control.seed(COLLECTIONS.adminConfig, [{ _id: 'auth', keyHash: sha(SUPER), role: 'superadmin' }])
      control.seed(COLLECTIONS.orders, [{ _id: 'o1', id: 'o1', _openid: 'oB', status: 'paid', amount: 100, items: [], feeMismatch: true }])
    })

    // HTTP 码按网关 ERR_STATUS 表：读失败 503 + DOC_READ_FAIL，缺档 400 + NO_ORDER
    it('getOrderDetail：缺档 NO_ORDER，读失败 DOC_READ_FAIL', async () => {
      expect(await admin('getOrderDetail', { id: 'ghost' })).toMatchObject({ status: 400, error: 'NO_ORDER' })
      readFail(COLLECTIONS.orders, 'o1')
      expect(await admin('getOrderDetail', { id: 'o1' })).toMatchObject({ status: 503, error: 'DOC_READ_FAIL' })
    })

    it('shipOrder：缺档 NO_ORDER，读失败 DOC_READ_FAIL', async () => {
      expect((await admin('shipOrder', { id: 'ghost', company: 'SF', trackingNo: 'T' })).error).toBe('NO_ORDER')
      readFail(COLLECTIONS.orders, 'o1')
      expect((await admin('shipOrder', { id: 'o1', company: 'SF', trackingNo: 'T' })).error).toBe('DOC_READ_FAIL')
    })

    it('clearFeeMismatch：缺档 NO_ORDER，读失败 DOC_READ_FAIL 且不动标记', async () => {
      expect(await admin('clearFeeMismatch', { id: 'ghost' })).toMatchObject({ status: 400, error: 'NO_ORDER' })
      readFail(COLLECTIONS.orders, 'o1')
      expect(await admin('clearFeeMismatch', { id: 'o1' })).toMatchObject({ status: 503, error: 'DOC_READ_FAIL' })
      expect(control.dump(COLLECTIONS.orders)[0].feeMismatch).toBe(true)
    })
  })
})

describe('#400-4 写失败不静默', () => {
  it('发货后回写上传结果并释放锁的那次写失败：告警（锁要等陈旧期才能抢）', async () => {
    control.setOpenId('')
    control.seed(COLLECTIONS.adminConfig, [{ _id: 'auth', keyHash: sha(SUPER), role: 'superadmin' }])
    control.seed(COLLECTIONS.orders, [{ _id: 'o1', id: 'o1', _openid: 'oB', status: 'paid', amount: 100, transactionId: 'tx', items: [] }])
    control.setBeforeUpdate(async ({ coll, data }: any) => {
      if (coll === COLLECTIONS.orders && data.shipUploadLock === 'idle') throw new Error('MOCK_WRITE_FAIL')
    })
    const r = await admin('shipOrder', { id: 'o1', company: 'SF', trackingNo: 'T' })
    expect(r.ok).toBe(true) // 已发货是事实，回写失败不回滚
    const a = control.dump(COLLECTIONS.anomalies).find((x: any) => x.code === 'SHIP_RESULT_WRITE_FAIL')
    expect(a && a.ctx.orderId).toBe('o1')
  })

  describe('closeExpiredOrders 条件更新抛错', () => {
    const expired = (id: string) => ({ _id: id, id, status: 'pending', createdAt: Date.now() - 3_600_000, reserved: [{ productId: 'p1', spec: '', qty: 1 }] })
    beforeEach(() => {
      control.setOpenId('')
      control.seed('inventory', [{ _id: 'p1__', productId: 'p1', spec: '', stock: 0 }])
    })

    it('写其实落地了（回包丢了）：读回认出是本次关的，照常回补库存并告警', async () => {
      control.seed('orders', [expired('e1')])
      let inner = false
      control.setBeforeUpdate(async ({ coll, data }: any) => {
        if (coll !== 'orders' || data.status !== 'closed' || inner) return
        inner = true
        await cloud.database().collection('orders').doc('e1').update({ data })
        throw new Error('MOCK_TIMEOUT_AFTER_WRITE')
      })
      const r: any = await closeExpired()
      expect(r).toEqual({ ok: true, closed: 1 })
      expect(control.dump('orders')[0].status).toBe('closed')
      expect(control.dump('inventory')[0].stock).toBe(1)
      expect(control.dump('anomalies').some((x: any) => x.code === 'CLOSE_WRITE_FAIL')).toBe(true)
    })

    it('写没落地：告警，不回补；下次扫描照常关单回补（自愈）', async () => {
      control.seed('orders', [expired('e1')])
      control.setBeforeUpdate(async ({ coll, data }: any) => {
        if (coll === 'orders' && data.status === 'closed') throw new Error('MOCK_WRITE_FAIL')
      })
      expect(await closeExpired()).toEqual({ ok: true, closed: 0 })
      expect(control.dump('inventory')[0].stock).toBe(0)
      expect(control.dump('anomalies').some((x: any) => x.code === 'CLOSE_WRITE_FAIL')).toBe(true)
      control.setBeforeUpdate(null as any)
      expect(await closeExpired()).toEqual({ ok: true, closed: 1 })
      expect(control.dump('inventory')[0].stock).toBe(1)
    })

    it('写抛错、读回已 closed 但 closedAt 不是本次写的（别人并发关的）：不认领、不回补', async () => {
      control.seed('orders', [expired('e1')])
      let inner = false
      control.setBeforeUpdate(async ({ coll, data }: any) => {
        if (coll !== 'orders' || data.status !== 'closed' || inner) return
        inner = true
        await cloud.database().collection('orders').doc('e1').update({ data: { status: 'closed', closedAt: 1 } })
        throw new Error('MOCK_WRITE_FAIL')
      })
      expect(await closeExpired()).toEqual({ ok: true, closed: 0 })
      expect(control.dump('inventory')[0].stock).toBe(0) // 回补归关单的那一方，这里再补就多补
      const a = control.dump('anomalies').find((x: any) => x.code === 'CLOSE_WRITE_FAIL')
      expect(a && a.ctx.readBack).toBe('closed')
    })
  })

  // pay 惰性关单、用户取消与定时器走同一个关单函数：写落地但回包丢了，照样认领回补；定时器只扫 pending，扫不到它
  describe('pay 惰性关单 / cancelOrder 条件写抛错', () => {
    const seed = (createdAt: number) => {
      control.seed('orders', [{ _id: 'o1', id: 'o1', _openid: 'oME', status: 'pending', amount: 178, createdAt, reserved: [{ productId: 'p1', spec: '', qty: 1 }] }])
      control.seed('inventory', [{ _id: 'p1__', productId: 'p1', spec: '', stock: 0 }])
      control.seed('config', [{ _id: 'pay', mode: 'real', flowId: 'flow-pay' }])
    }
    const landThenThrow = () => {
      let inner = false
      control.setBeforeUpdate(async ({ coll, data }: any) => {
        if (coll !== 'orders' || data.status !== 'closed' || inner) return
        inner = true
        await cloud.database().collection('orders').doc('o1').update({ data })
        throw new Error('MOCK_TIMEOUT_AFTER_WRITE')
      })
    }

    it('pay 惰性关单：写落地回包丢了，照常回补并回 ORDER_CLOSED', async () => {
      seed(Date.now() - 3_600_000)
      landThenThrow()
      expect((await call('pay', { id: 'o1' })).error).toBe('ORDER_CLOSED')
      expect(control.dump('orders')[0].status).toBe('closed')
      expect(control.dump('inventory')[0].stock).toBe(1)
    })

    it('cancelOrder：写落地回包丢了，照常回补并回成功', async () => {
      seed(Date.now())
      landThenThrow()
      expect((await call('cancelOrder', { id: 'o1' })).ok).toBe(true)
      expect(control.dump('orders')[0]).toMatchObject({ status: 'closed', cancelledBy: 'user' })
      expect(control.dump('inventory')[0].stock).toBe(1)
    })

    it('cancelOrder：写没落地，不回补、告警、报错（不冒充状态不对）', async () => {
      seed(Date.now())
      control.setBeforeUpdate(async ({ coll, data }: any) => {
        if (coll === 'orders' && data.status === 'closed') throw new Error('MOCK_WRITE_FAIL')
      })
      const r = await call('cancelOrder', { id: 'o1' })
      expect(r.ok).toBe(false)
      expect(String(r.error)).not.toMatch(/^BAD_STATUS/)
      expect(control.dump('inventory')[0].stock).toBe(0)
      const a = control.dump('anomalies').find((x: any) => x.code === 'CLOSE_WRITE_FAIL')
      expect(a && a.ctx.readBack).toBe('pending')
    })
  })
})

describe('#400-5 createOrder 条目 id 走 str() 清洗', () => {
  beforeEach(() => {
    process.env.ALLOW_MOCK_PAY = '1'
  })
  it('对象/数字 id 当空丢掉，超长 id 截到 200 再查', async () => {
    const place = (items: unknown) => call('createOrder', { items, address: ADDR })
    expect((await place([{ id: { $ne: null }, qty: 1 }])).error).toBe('EMPTY_ITEMS')
    expect((await place([{ id: 123, qty: 1 }])).error).toBe('EMPTY_ITEMS')
    const r = await place([{ id: 'x'.repeat(500), qty: 1 }])
    expect(r.error).toBe('UNKNOWN_ITEM:' + 'x'.repeat(200))
  })
})

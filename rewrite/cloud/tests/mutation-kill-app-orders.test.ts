// 变异分诊：app/actions/orders.ts 存活变异的杀手测试（下单幂等键归一与撞号判定、支付的超时边界/惰性关单/0 元单并发/
// 工作流入参、申请售后的查重与额度、确认收货与取消的落库字段和并发、列表排序与封面换址）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import cloud, { control } from 'wx-server-sdk'
import { COLLECTIONS, PAY_WINDOW_MS } from '@ldrw/shared'
import { main as app } from '../src/functions/app/index'
import { __resetTempUrlCacheForTest } from '../src/kit/storage'

const call = (action: string, data: Record<string, unknown> = {}) => app({ action, data }) as Promise<any>
const db = cloud.database()
const ADDR = { name: '张三', phone: '13800000000', region: '浙江·杭州', detail: 'xx 路 1 号' }
const LINE_A = { productId: 'p1', lineId: 'p1__', spec: '', name: '小鸭礼盒', price: 50, qty: 1, refundable: true }
const LINE_B = { productId: 'p2', lineId: 'p2__', spec: '', name: '小熊礼盒', price: 50, qty: 1, refundable: true }
const seedOrder = (over: Record<string, unknown> = {}) =>
  control.seed(COLLECTIONS.orders, [
    {
      _id: 'o1',
      id: 'o1',
      _openid: 'oME',
      status: 'paid',
      amount: 100,
      goods: 100,
      createdAt: Date.now(),
      items: [LINE_A, LINE_B],
      address: ADDR,
      reserved: [{ productId: 'p1', spec: '', qty: 1 }],
      ...over,
    },
  ])
const orderDoc = () => control.dump(COLLECTIONS.orders).find((o: any) => o._id === 'o1')
const stock = () => control.dump(COLLECTIONS.inventory).find((i: any) => i._id === 'p1__')?.stock
const realPay = (over: Record<string, unknown> = {}) =>
  control.seed(COLLECTIONS.config, [{ _id: 'pay', mode: 'real', flowId: 'flow-pay', ...over }])
const PREPAY = { timeStamp: '1', nonceStr: 'n', packageVal: 'pkg=x', signType: 'MD5', paySign: 'sig' }
// 并发方在这次写之前抢先改了单；只触发一次，防内层写再进钩子
const raceOnce = (match: (data: any) => boolean, act: () => Promise<unknown>) => {
  let fired = false
  control.setBeforeUpdate(async ({ coll, data }: any) => {
    if (fired || coll !== COLLECTIONS.orders || !match(data)) return
    fired = true
    await act()
  })
}
const patchOrder = (patch: Record<string, unknown>) => () => db.collection(COLLECTIONS.orders).doc('o1').update({ data: patch })
const removeOrder = () => db.collection(COLLECTIONS.orders).doc('o1').remove()
let lines: string[] = []

beforeEach(() => {
  control.reset()
  __resetTempUrlCacheForTest()
  control.setOpenId('oME')
  process.env.ALLOW_MOCK_PAY = '1'
  control.seed(COLLECTIONS.products, [{ _id: 'p1', id: 'p1', name: '小鸭礼盒', price: 198, tag: '' }])
  control.seed(COLLECTIONS.inventory, [{ _id: 'p1__', productId: 'p1', spec: '', stock: 5 }])
  lines = []
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void lines.push(String(a[0])))
})
afterEach(() => {
  delete process.env.ALLOW_MOCK_PAY
  delete process.env.LD_IMAGE_PROC
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('createOrder', () => {
  const create = (over: Record<string, unknown> = {}) => call('createOrder', { items: [{ id: 'p1', qty: 1 }], address: ADDR, ...over })

  it('一分钟内第 21 次下单被限速', async () => {
    let last: any
    for (let i = 0; i < 21; i++) last = await call('createOrder', { items: [] })
    expect(last.error).toBe('RATE_LIMITED')
  })

  it('没带幂等键：不去写幂等记录', async () => {
    let writes = 0
    control.setBeforeUpdate(async ({ coll }: any) => {
      if (coll === COLLECTIONS.orderIdempotency) writes++
    })
    expect((await create()).ok).toBe(true)
    expect(writes).toBe(0)
  })

  it('同一幂等键重试：原样回同一单；撞键时不去建集合', async () => {
    const first = await create({ idempotencyKey: 'k1' })
    const created = vi.spyOn(db, 'createCollection')
    const again = await create({ idempotencyKey: 'k1' })
    expect(again.order.id).toBe(first.order.id)
    expect(created).not.toHaveBeenCalled()
  })

  it('幂等键两头空格去掉、超过 200 字只看前 200 字：都算同一次提交', async () => {
    const a = await create({ idempotencyKey: ' k2 ' })
    expect((await create({ idempotencyKey: 'k2' })).order.id).toBe(a.order.id)
    const long = 'x'.repeat(200)
    const b = await create({ idempotencyKey: long + 'A' })
    expect((await create({ idempotencyKey: long + 'B' })).order.id).toBe(b.order.id)
    expect(control.dump(COLLECTIONS.orders)).toHaveLength(2)
  })

  it('撞键后读幂等记录一直失败：等完回 ORDER_CLAIM_PENDING，不报错', async () => {
    await create({ idempotencyKey: 'k3' })
    control.setBeforeGet(async ({ coll, id }: any) => {
      if (coll === COLLECTIONS.orderIdempotency && id) throw new Error('NETWORK_TIMEOUT')
    })
    expect((await create({ idempotencyKey: 'k3' })).error).toBe('ORDER_CLAIM_PENDING')
  })

  it('幂等记录回填订单号失败：单照建，留一行 CLAIM_UPDATE_FAIL', async () => {
    control.setBeforeUpdate(async ({ coll }: any) => {
      if (coll === COLLECTIONS.orderIdempotency) throw new Error('MOCK_WRITE_FAIL')
    })
    const r = await create({ idempotencyKey: 'k4' })
    expect(r.ok).toBe(true)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(
      new RegExp(`^\\[LD_ALERT\\] sev=money fn=createOrder code=CLAIM_UPDATE_FAIL ctx=\\{"orderId":"${r.order.id}","claimId":"oi_[0-9a-z]+"\\}$`)
    )
  })

  it('建单写失败且读回也失败：回 ORDER_CLAIM_PENDING，留一行 ORDER_READBACK_FAIL', async () => {
    control.setBeforeAdd(async ({ coll }: any) => {
      if (coll === COLLECTIONS.orders) throw new Error('NETWORK_TIMEOUT')
    })
    control.setBeforeGet(async ({ coll, id }: any) => {
      if (coll === COLLECTIONS.orders && id) throw new Error('NETWORK_TIMEOUT')
    })
    expect((await create()).error).toBe('ORDER_CLAIM_PENDING')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/^\[LD_ALERT\] sev=money fn=createOrder code=ORDER_READBACK_FAIL ctx=\{"orderId":"\d{16}","claimId":""\}$/)
  })

  it('单号撞上别人同一毫秒建的单：不当成自己的，换号耗尽回 ORDER_ID_BUSY', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(1_800_000_000_000)
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    control.setOpenId('oOTHER')
    expect((await create()).ok).toBe(true)
    control.setOpenId('oME')
    expect((await create()).error).toBe('ORDER_ID_BUSY')
    expect(control.dump(COLLECTIONS.orders).map((o: any) => o._openid)).toEqual(['oOTHER'])
  })

  it('条目过滤：空条目、缺商品号、数量 0 或负数都剔掉，剩不下就 EMPTY_ITEMS', async () => {
    expect((await call('createOrder', { items: [null], address: ADDR })).error).toBe('EMPTY_ITEMS')
    expect((await call('createOrder', { items: [{ qty: 1 }], address: ADDR })).error).toBe('EMPTY_ITEMS')
    expect((await call('createOrder', { items: [{ id: 'p1', qty: 0 }], address: ADDR })).error).toBe('EMPTY_ITEMS')
    expect((await call('createOrder', { items: [{ id: 'p1', qty: -1 }], address: ADDR })).error).toBe('EMPTY_ITEMS')
  })

  it('条数恰好 100、单行数量恰好 999：放行；任一行超 999 就 BAD_QTY', async () => {
    control.seed(COLLECTIONS.products, [{ _id: 'p9', id: 'p9', name: '不限量', price: 1, tag: '' }])
    const hundred = Array.from({ length: 100 }, () => ({ id: 'p9', qty: 1 }))
    expect((await call('createOrder', { items: hundred, address: ADDR })).ok).toBe(true)
    expect((await call('createOrder', { items: [{ id: 'p9', qty: 999 }], address: ADDR })).ok).toBe(true)
    expect((await call('createOrder', { items: [{ id: 'p9', qty: 1 }, { id: 'p9', qty: 1000 }], address: ADDR })).error).toBe('BAD_QTY')
  })

  it('商品目录超过 100 个：排在第 101 个的在售商品照样能下单', async () => {
    control.seed(
      COLLECTIONS.products,
      Array.from({ length: 100 }, (_, i) => ({ _id: 'q' + i, id: 'q' + i, name: '品' + i, price: 1, tag: '' }))
    )
    expect((await call('createOrder', { items: [{ id: 'q99', qty: 1 }], address: ADDR })).ok).toBe(true)
  })

  it('新单每行默认可退；搭配购行规格为空、行号＝编号__', async () => {
    const r = await call('createOrder', { items: [{ id: 'p1', qty: 1 }, { id: 'hook', qty: 1 }], address: ADDR })
    expect(r.order.items.map((it: any) => [it.lineId, it.spec, it.refundable])).toEqual([
      ['p1__', '', true],
      ['hook__', '', true],
    ])
  })

  it('SKU 名只取前 30 字', async () => {
    const sku = 'S'.repeat(40)
    expect((await call('createOrder', { items: [{ id: 'p1', qty: 1, sku }], address: ADDR })).error).toBe('UNKNOWN_SKU:p1:' + 'S'.repeat(30))
  })
})

describe('pay', () => {
  it('一分钟内第 21 次发起支付被限速（支付会外呼微信下单）', async () => {
    let last: any
    for (let i = 0; i < 21; i++) last = await call('pay', { id: 'ghost' })
    expect(last.error).toBe('RATE_LIMITED')
  })

  it('恰好到支付窗时长：还没超时，照常发起支付', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(1_800_000_000_000)
    realPay()
    control.setCallFunctionResult({ result: { data: PREPAY } })
    seedOrder({ status: 'pending', createdAt: Date.now() - PAY_WINDOW_MS })
    expect((await call('pay', { id: 'o1' })).ok).toBe(true)
  })

  it('超时惰性关单：记关单时间；关单前被并发付款抢先就不回补库存', async () => {
    realPay()
    seedOrder({ status: 'pending', createdAt: Date.now() - PAY_WINDOW_MS - 1000 })
    raceOnce((d) => d.status === 'closed', patchOrder({ status: 'paid' }))
    expect((await call('pay', { id: 'o1' })).error).toBe('ORDER_CLOSED')
    expect(orderDoc().status).toBe('paid')
    expect(stock()).toBe(5)
  })

  it('超时惰性关单正常路径：关单时间落库', async () => {
    realPay()
    seedOrder({ status: 'pending', createdAt: Date.now() - PAY_WINDOW_MS - 1000 })
    expect((await call('pay', { id: 'o1' })).error).toBe('ORDER_CLOSED')
    expect(typeof orderDoc().closedAt).toBe('number')
  })

  it('支付没开：real 但没配工作流、或配了工作流但不是 real，都回 PAY_NOT_ENABLED', async () => {
    seedOrder({ status: 'pending' })
    realPay({ flowId: '' })
    expect((await call('pay', { id: 'o1' })).error).toBe('PAY_NOT_ENABLED')
    control.reset()
    control.setOpenId('oME')
    seedOrder({ status: 'pending' })
    control.seed(COLLECTIONS.config, [{ _id: 'pay', mode: 'mock', flowId: 'flow-pay' }])
    expect((await call('pay', { id: 'o1' })).error).toBe('PAY_NOT_ENABLED')
  })

  it('0 元单：直接置已付，支付时间落库且与返回一致', async () => {
    realPay()
    seedOrder({ status: 'pending', amount: 0 })
    const r = await call('pay', { id: 'o1' })
    expect(r.paid).toBe(true)
    expect(orderDoc().paidAt).toBe(r.paidAt)
  })

  it('0 元单被并发关单：回 BAD_STATUS:closed，不谎报成功', async () => {
    realPay()
    seedOrder({ status: 'pending', amount: 0 })
    raceOnce((d) => d.status === 'paid', patchOrder({ status: 'closed' }))
    expect((await call('pay', { id: 'o1' })).error).toBe('BAD_STATUS:closed')
  })

  it('0 元单被并发付掉：幂等成功，支付时间用对方落的那个', async () => {
    realPay()
    seedOrder({ status: 'pending', amount: 0 })
    raceOnce((d) => d.status === 'paid', patchOrder({ status: 'paid', paidAt: 111 }))
    expect(await call('pay', { id: 'o1' })).toEqual({ ok: true, paid: true, paidAt: 111 })
  })

  it('0 元单写之前单被删：回 BAD_STATUS:unknown', async () => {
    realPay()
    seedOrder({ status: 'pending', amount: 0 })
    raceOnce((d) => d.status === 'paid', removeOrder)
    expect((await call('pay', { id: 'o1' })).error).toBe('BAD_STATUS:unknown')
  })

  it('工作流入参：描述＝「小棉鸭 · 首件商品名」截 40 字、币种 CNY；没有条目用「钩织材料包」', async () => {
    realPay()
    control.setCallFunctionResult({ result: { data: PREPAY } })
    seedOrder({ status: 'pending' })
    await call('pay', { id: 'o1' })
    expect(control.callFunctionCalls()[0].data.data).toMatchObject({
      description: '小棉鸭 · 小鸭礼盒',
      amount: { total: 10000, currency: 'CNY' },
    })
    control.reset()
    control.setOpenId('oME')
    realPay()
    control.setCallFunctionResult({ result: { data: PREPAY } })
    seedOrder({ status: 'pending', items: [{ ...LINE_A, name: '长'.repeat(60) }] })
    await call('pay', { id: 'o1' })
    expect(control.callFunctionCalls()[0].data.data.description).toBe(('小棉鸭 · ' + '长'.repeat(60)).slice(0, 40))
    control.reset()
    control.setOpenId('oME')
    realPay()
    control.setCallFunctionResult({ result: { data: PREPAY } })
    seedOrder({ status: 'pending', items: undefined })
    await call('pay', { id: 'o1' })
    expect(control.callFunctionCalls()[0].data.data.description).toBe('小棉鸭 · 钩织材料包')
  })

  it('拿不到预付单：留一行 NO_PREPAY（带订单号）', async () => {
    realPay()
    seedOrder({ status: 'pending' })
    expect((await call('pay', { id: 'o1' })).error).toBe('UNIFIED_ORDER_FAIL')
    expect(lines.filter((l) => l.includes('NO_PREPAY'))).toEqual(['[LD_ALERT] sev=money fn=pay code=NO_PREPAY ctx={"orderId":"o1"}'])
  })

  it('工作流没回签名类型、没回 package：签名类型默认 RSA、package 为空串；回了就照用', async () => {
    realPay()
    seedOrder({ status: 'pending' })
    control.setCallFunctionResult({ result: { data: { timeStamp: '1', nonceStr: 'n', paySign: 'sig' } } })
    expect((await call('pay', { id: 'o1' })).payment).toMatchObject({ signType: 'RSA', package: '' })
    control.setCallFunctionResult({ result: { data: PREPAY } })
    expect((await call('pay', { id: 'o1' })).payment).toMatchObject({ signType: 'MD5', package: 'pkg=x' })
  })
})

describe('applyRefund', () => {
  it('缺订单号、缺行号：BAD_ARGS', async () => {
    seedOrder()
    expect((await call('applyRefund', { lineId: 'p1__' })).error).toBe('BAD_ARGS')
    expect((await call('applyRefund', { orderId: 'o1' })).error).toBe('BAD_ARGS')
  })

  it('没写理由、订单没地址：售后单理由/联系人/电话落空串，状态 applied', async () => {
    seedOrder({ address: undefined })
    const r = await call('applyRefund', { orderId: 'o1', lineId: 'p1__' })
    expect(r.afterSale).toMatchObject({ reason: '', addressName: '', phone: '', status: 'applied' })
  })

  it('别的订单同一行号的售后不挡本单；本单同行已有售后（哪怕编号不同）就挡；本单别的行有售后不挡', async () => {
    seedOrder()
    control.seed(COLLECTIONS.afterSales, [{ _id: 'o2__p1__', orderId: 'o2', lineId: 'p1__', productId: 'p1', status: 'applied', refundAmount: 1 }])
    expect((await call('applyRefund', { orderId: 'o1', lineId: 'p1__' })).ok).toBe(true)
    control.reset()
    control.setOpenId('oME')
    seedOrder()
    control.seed(COLLECTIONS.afterSales, [
      { _id: 'legacy1', orderId: 'o1', lineId: 'p1__', productId: 'p1', status: 'rejected', refundAmount: 0 },
      { _id: 'o1__p2__', orderId: 'o1', lineId: 'p2__', productId: 'p2', status: 'rejected', refundAmount: 0 },
    ])
    expect((await call('applyRefund', { orderId: 'o1', lineId: 'p1__' })).error).toBe('ALREADY_APPLIED')
    expect((await call('applyRefund', { orderId: 'o1', lineId: 'p2__' })).error).toBe('ALREADY_APPLIED')
  })

  it('本单别的行有被拒售后：本行照常可申请', async () => {
    seedOrder()
    control.seed(COLLECTIONS.afterSales, [{ _id: 'o1__p2__', orderId: 'o1', lineId: 'p2__', productId: 'p2', status: 'rejected', refundAmount: 0 }])
    expect((await call('applyRefund', { orderId: 'o1', lineId: 'p1__' })).ok).toBe(true)
  })

  it('已发货、已完成的单都能申请；理由截 200 字；规格随行存下', async () => {
    seedOrder({ status: 'shipped', items: [{ ...LINE_A, spec: '红', lineId: 'p1__红' }, LINE_B] })
    const r = await call('applyRefund', { orderId: 'o1', lineId: 'p1__红', reason: '理'.repeat(300) })
    expect(r.afterSale.reason).toBe('理'.repeat(200))
    expect(r.afterSale.spec).toBe('红')
    control.reset()
    control.setOpenId('oME')
    seedOrder({ status: 'done' })
    expect((await call('applyRefund', { orderId: 'o1', lineId: 'p1__' })).ok).toBe(true)
  })

  it('这一行已全部进课（没标不可退）：NOT_REFUNDABLE；部分进课按剩余件数算钱', async () => {
    seedOrder({ items: [{ ...LINE_A, qty: 2, enteredQty: 2 }, LINE_B] })
    expect((await call('applyRefund', { orderId: 'o1', lineId: 'p1__' })).error).toBe('NOT_REFUNDABLE')
    control.reset()
    control.setOpenId('oME')
    seedOrder({ amount: 200, goods: 200, items: [{ ...LINE_A, qty: 3, enteredQty: 1 }, LINE_B] })
    const r = await call('applyRefund', { orderId: 'o1', lineId: 'p1__' })
    expect(r.afterSale).toMatchObject({ qty: 2, itemTotal: 100, refundAmount: 100 })
  })

  it('被拒的售后不占额度；额度被占满回 NOTHING_LEFT', async () => {
    seedOrder({ amount: 60 })
    control.seed(COLLECTIONS.afterSales, [{ _id: 'o1__p2__', orderId: 'o1', lineId: 'p2__', productId: 'p2', status: 'rejected', refundAmount: 40 }])
    expect((await call('applyRefund', { orderId: 'o1', lineId: 'p1__' })).afterSale.refundAmount).toBe(30)
    control.reset()
    control.setOpenId('oME')
    seedOrder({ amount: 60 })
    control.seed(COLLECTIONS.afterSales, [{ _id: 'o1__p2__', orderId: 'o1', lineId: 'p2__', productId: 'p2', status: 'approved', refundAmount: 60 }])
    expect((await call('applyRefund', { orderId: 'o1', lineId: 'p1__' })).error).toBe('NOTHING_LEFT')
  })

  it('同单已占额度按累加扣：退款额被全单剩余封顶', async () => {
    seedOrder({ amount: 60 })
    control.seed(COLLECTIONS.afterSales, [{ _id: 'o1__p2__', orderId: 'o1', lineId: 'p2__', productId: 'p2', status: 'approved', refundAmount: 40 }])
    expect((await call('applyRefund', { orderId: 'o1', lineId: 'p1__' })).afterSale.refundAmount).toBe(20)
  })

  it('售后集合还没建（读报集合不存在）：当没有售后，照常申请', async () => {
    seedOrder()
    control.setBeforeGet(async ({ coll, filter }: any) => {
      if (coll === COLLECTIONS.afterSales && filter) throw new Error('DATABASE_COLLECTION_NOT_EXIST')
    })
    expect((await call('applyRefund', { orderId: 'o1', lineId: 'p1__' })).ok).toBe(true)
  })

  it('同单售后触顶：拒退，留一行 AFTERSALE_SCAN_CAP（带订单号）', async () => {
    seedOrder()
    control.seed(
      COLLECTIONS.afterSales,
      Array.from({ length: 1000 }, (_, i) => ({ _id: 'f' + i, orderId: 'o1', lineId: 'x' + i, status: 'rejected', refundAmount: 0 }))
    )
    expect((await call('applyRefund', { orderId: 'o1', lineId: 'p1__' })).error).toBe('REFUND_SCAN_CAP')
    expect(lines).toEqual(['[LD_ALERT] sev=money fn=applyRefund code=AFTERSALE_SCAN_CAP ctx={"orderId":"o1"}'])
  })

  it('并发双发：后写的撞上先写的同号售后单，回 ALREADY_APPLIED', async () => {
    seedOrder()
    let fired = false
    control.setBeforeAdd(async ({ coll }: any) => {
      if (coll !== COLLECTIONS.afterSales || fired) return
      fired = true
      control.seed(COLLECTIONS.afterSales, [{ _id: 'o1__p1__', orderId: 'o1', lineId: 'p1__', status: 'applied', refundAmount: 50 }])
    })
    expect((await call('applyRefund', { orderId: 'o1', lineId: 'p1__' })).error).toBe('ALREADY_APPLIED')
  })
})

describe('confirmReceive', () => {
  it('缺单号：NO_ID；确认成功：完成时间落库且与返回一致', async () => {
    expect((await call('confirmReceive', {})).error).toBe('NO_ID')
    seedOrder({ status: 'shipped' })
    const r = await call('confirmReceive', { id: 'o1' })
    expect(typeof r.doneAt).toBe('number')
    expect(orderDoc()).toMatchObject({ status: 'done', doneAt: r.doneAt })
  })

  it('读到已发货后被并发推进：回当前状态；单被删回 unknown', async () => {
    seedOrder({ status: 'shipped' })
    raceOnce((d) => d.status === 'done', patchOrder({ status: 'refund_required' }))
    expect((await call('confirmReceive', { id: 'o1' })).error).toBe('BAD_STATUS:refund_required')
    control.reset()
    control.setOpenId('oME')
    seedOrder({ status: 'shipped' })
    raceOnce((d) => d.status === 'done', removeOrder)
    expect((await call('confirmReceive', { id: 'o1' })).error).toBe('BAD_STATUS:unknown')
  })
})

describe('cancelOrder', () => {
  it('取消成功：关单时间与「用户取消」标记落库，返回关单时间；老单没 reserved 也不报错', async () => {
    seedOrder({ status: 'pending', reserved: undefined })
    const r = await call('cancelOrder', { id: 'o1' })
    expect(typeof r.closedAt).toBe('number')
    expect(orderDoc()).toMatchObject({ status: 'closed', cancelledBy: 'user' })
    expect(typeof orderDoc().closedAt).toBe('number')
  })

  it('读到待支付后被并发付掉：回 BAD_STATUS:paid，不回补库存；单被删回 unknown', async () => {
    seedOrder({ status: 'pending' })
    raceOnce((d) => d.status === 'closed', patchOrder({ status: 'paid' }))
    expect((await call('cancelOrder', { id: 'o1' })).error).toBe('BAD_STATUS:paid')
    expect(stock()).toBe(5)
    control.reset()
    control.setOpenId('oME')
    seedOrder({ status: 'pending' })
    raceOnce((d) => d.status === 'closed', removeOrder)
    expect((await call('cancelOrder', { id: 'o1' })).error).toBe('BAD_STATUS:unknown')
  })
})

describe('读接口', () => {
  it('我的订单按下单时间倒序；我的售后按申请时间倒序', async () => {
    // 编号顺序故意和时间顺序对不上：排序字段一旦丢了，按编号兜底排出来的顺序会不同
    control.seed(COLLECTIONS.orders, [
      { _id: 'c', _openid: 'oME', createdAt: 1, items: [] },
      { _id: 'a', _openid: 'oME', createdAt: 3, items: [] },
      { _id: 'b', _openid: 'oME', createdAt: 2, items: [] },
    ])
    control.seed(COLLECTIONS.afterSales, [
      { _id: 'z', _openid: 'oME', appliedAt: 1 },
      { _id: 'x', _openid: 'oME', appliedAt: 3 },
      { _id: 'y', _openid: 'oME', appliedAt: 2 },
    ])
    expect((await call('getMyOrders')).list.map((o: any) => o._id)).toEqual(['a', 'b', 'c'])
    expect((await call('getMyAfterSales')).list.map((a: any) => a._id)).toEqual(['x', 'y', 'z'])
  })

  it('按单号取单缺单号：NO_ID', async () => {
    expect((await call('getOrderById', {})).error).toBe('NO_ID')
  })

  it('条目没有封面字段：照常返回，不补封面', async () => {
    seedOrder()
    const r = await call('getOrderById', { id: 'o1' })
    expect(r.order.items[0]).toStrictEqual(LINE_A)
  })

  it('封面已是 https：原样返回，不去换址', async () => {
    seedOrder({ items: [{ ...LINE_A, cover: 'https://cdn/x.png' }] })
    expect((await call('getOrderById', { id: 'o1' })).order.items[0].cover).toBe('https://cdn/x.png')
    expect(control.tempUrlCalls()).toEqual([])
  })

  it('云存储封面：换址带图片处理参数，且签发结果缓存复用；同单没封面的条目不补封面', async () => {
    process.env.LD_IMAGE_PROC = 'imageMogr2/thumbnail/300x'
    seedOrder({ items: [{ ...LINE_A, cover: 'cloud://env/a.png' }, LINE_B] })
    const r = await call('getOrderById', { id: 'o1' })
    expect(r.order.items[0].cover).toBe('https://tmp/cloud://env/a.png?imageMogr2/thumbnail/300x')
    expect(r.order.items[1]).toStrictEqual(LINE_B)
    await call('getOrderById', { id: 'o1' })
    expect(control.tempUrlCalls()).toEqual([1])
  })
})

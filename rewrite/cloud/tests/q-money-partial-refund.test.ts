// 部分退款不卡发货：退款按件退，发货只排除已退的件，其余照发；在途售后（申请中/已批）仍整单拦。
// 首次发货须带上发货人看到的已退件数（ackRefundedQty）：和现在对不上就拒，免得照过期标签把已退的件装箱。
import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as adminApi } from '../src/functions/adminApi/index'
import { sha } from '../src/functions/adminApi/lib'

const post = (action: string, data: Record<string, unknown> = {}) =>
  adminApi({
    httpMethod: 'POST',
    headers: { 'x-forwarded-for': '1.1.1.1' },
    body: JSON.stringify({ action, key: 'super-secret-key', data }),
  }).then((r: any) => ({ status: r.statusCode, ...JSON.parse(r.body) }))

const ITEMS = [
  { productId: 'p1', lineId: 'p1__红', spec: '红', name: '鸭', price: 100, qty: 1, refundable: true },
  { productId: 'addon-yarn', lineId: 'addon-yarn__', spec: '', name: '线包', price: 20, qty: 2, refundable: true },
]
const seedOrder = (id: string, items: any[] = ITEMS) =>
  control.seed('orders', [{ _id: id, id, _openid: 'oB', status: 'paid', amount: 140, goods: 140, createdAt: 1000, items }])
const seedAS = (orderId: string, lineId: string, status: string, qty?: number) =>
  control.seed('afterSales', [
    { _id: orderId + '__' + lineId, orderId, lineId, productId: lineId.split('__')[0], status, refundAmount: 40, ...(qty ? { qty } : {}) },
  ])
const ship = (id: string, ackRefundedQty?: Record<string, number>) =>
  post('shipOrder', { id, company: '顺丰', trackingNo: 'SF1', ackRefundedQty })
const ledger = () => control.dump('stockLedger').map((l: any) => [l._id, l.delta])

beforeEach(() => {
  control.reset()
  control.setOpenId('')
  control.seed('adminConfig', [{ _id: 'auth', keyHash: sha('super-secret-key'), role: 'superadmin', name: '店主' }])
})

describe('shipOne：只拦在途售后，已退的件不卡其余件', () => {
  it('大白话：两行订单退掉线包那行后，确认过已退件数，主商品照常发货；核销只记发出去的', async () => {
    seedOrder('o1')
    seedAS('o1', 'addon-yarn__', 'refunded', 2)
    const r = await ship('o1', { 'addon-yarn__': 2 })
    expect(r.ok).toBe(true)
    expect(r.refundedQty).toEqual({ 'addon-yarn__': 2 })
    expect(control.dump('orders')[0].status).toBe('shipped')
    expect(ledger()).toEqual([['ship:o1:fg:p1__红', -1]])
  })

  it('大白话：进过课的那件没退——qty=2、进课 1 件、退了 1 件，单行单照发 1 件，不是永远卡住', async () => {
    seedOrder('o1', [{ productId: 'p1', lineId: 'p1__红', spec: '红', name: '鸭', price: 100, qty: 2, enteredQty: 1, refundable: true }])
    seedAS('o1', 'p1__红', 'refunded', 1)
    const r = await ship('o1', { 'p1__红': 1 })
    expect(r.ok).toBe(true)
    expect(ledger()).toEqual([['ship:o1:fg:p1__红', -1]])
  })

  it('大白话：多行单里部分退的那行，剩下没退的件照装照核销', async () => {
    seedOrder('o1', [ITEMS[0], { ...ITEMS[1], enteredQty: 1 }])
    seedAS('o1', 'addon-yarn__', 'refunded', 1)
    expect((await ship('o1', { 'addon-yarn__': 1 })).ok).toBe(true)
    expect(ledger()).toEqual([
      ['ship:o1:fg:p1__红', -1],
      ['ship:o1:fg:addon-yarn__', -1],
    ])
  })

  it('大白话：发货人没看到的退款（标签打完才退 / 页面没带确认）——拒发并回当前已退件数', async () => {
    seedOrder('o1')
    seedAS('o1', 'addon-yarn__', 'refunded', 2)
    for (const ack of [undefined, {}, { 'addon-yarn__': 1 }] as Array<Record<string, number> | undefined>) {
      const r = await ship('o1', ack)
      expect(r.error).toBe('REFUND_LINES_CHANGED')
      expect(r.refundedQty).toEqual({ 'addon-yarn__': 2 })
    }
    expect(control.dump('orders')[0].status).toBe('paid')
  })

  it('大白话：已发货单改运单号不重新装箱——发货后才退的件不要求确认', async () => {
    control.seed('orders', [{ _id: 'o1', id: 'o1', _openid: 'oB', status: 'shipped', amount: 140, goods: 140, createdAt: 1000, items: ITEMS }])
    seedAS('o1', 'addon-yarn__', 'refunded', 2)
    expect((await ship('o1')).ok).toBe(true)
  })

  it('大白话：没有任何退款的单，不带确认照常发', async () => {
    seedOrder('o1')
    expect((await ship('o1')).ok).toBe(true)
  })

  it('大白话：申请中/已批的售后仍拦发货（钱可能正在退）', async () => {
    for (const st of ['applied', 'approved']) {
      const oid = 'o_' + st
      seedOrder(oid)
      seedAS(oid, 'addon-yarn__', st, 2)
      const r = await ship(oid)
      expect(r.error).toBe('REFUND_HOLD')
      expect(r.lines).toEqual(['addon-yarn__'])
    }
  })

  it('大白话：每一行都退够件数——没东西可发，仍拦；缺 qty 的旧售后按整行算', async () => {
    seedOrder('o2')
    seedAS('o2', 'p1__红', 'refunded')
    seedAS('o2', 'addon-yarn__', 'refunded', 2)
    expect((await ship('o2', { 'p1__红': 1, 'addon-yarn__': 2 })).error).toBe('REFUND_HOLD')
  })
})

describe('listOrders：refundHold 只标在途或全退，另给每行已退件数', () => {
  it('大白话：部分已退的单可发（不标持有）但带已退件数；在途单标持有；全退单也标持有；部分件退不算全退', async () => {
    seedOrder('oPart')
    seedAS('oPart', 'addon-yarn__', 'refunded', 2)
    seedOrder('oWait')
    seedAS('oWait', 'p1__红', 'applied', 1)
    seedOrder('oAll')
    seedAS('oAll', 'p1__红', 'refunded', 1)
    seedAS('oAll', 'addon-yarn__', 'refunded', 2)
    seedOrder('oHalf', [{ ...ITEMS[1], enteredQty: 1 }])
    seedAS('oHalf', 'addon-yarn__', 'refunded', 1)
    const r = await post('listOrders', { status: 'paid' })
    const by = Object.fromEntries(r.list.map((o: any) => [o.id, o]))
    expect(by.oPart.refundHold).toBe(false)
    expect(by.oPart.refundedQty).toEqual({ 'addon-yarn__': 2 })
    expect(by.oWait.refundHold).toBe(true)
    expect(by.oAll.refundHold).toBe(true)
    expect(by.oHalf.refundHold).toBe(false)
    expect(by.oHalf.refundedQty).toEqual({ 'addon-yarn__': 1 })
  })

  it('大白话：读不到售后——整页报错，不当成「没有退款」（否则已退的件会被当成要发的货）', async () => {
    seedOrder('o1')
    seedAS('o1', 'addon-yarn__', 'refunded', 2)
    control.setBeforeGet(async (a: any) => {
      if (a.coll === 'afterSales') throw new Error('DB_TIMEOUT')
    })
    const r = await post('listOrders', { status: 'paid' })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('REFUND_HOLD_READ_FAIL')
  })

  it('大白话：售后集合还没建——就是没有退款，列表照常', async () => {
    seedOrder('o1')
    control.setBeforeGet(async (a: any) => {
      if (a.coll === 'afterSales') throw new Error('DATABASE_COLLECTION_NOT_EXIST')
    })
    const r = await post('listOrders', { status: 'paid' })
    expect(r.ok).toBe(true)
    expect(r.list[0].refundedQty).toEqual({})
  })
})

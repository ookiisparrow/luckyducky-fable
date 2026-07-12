// 黄金 orders-money·applyRefund/refundCallback/confirmReceive/订单读 节（守卫 rw-money3-golden）。
import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as app } from '../src/functions/app/index'
import { main as refundCallback } from '../src/functions/callbacks/refundCallback'
import { refundNoFor, isValidRefundNo } from '../src/kit'

const call = (action: string, data: Record<string, unknown> = {}) => app({ action, data }) as Promise<any>
const cb = (e: Record<string, unknown>) => refundCallback(e) as Promise<any>

// 实付 178 = 商品 198 − 券 20（单品单件基准单）
const seedOrder = (over: Record<string, unknown> = {}) =>
  control.seed('orders', [
    {
      _id: 'o1',
      id: 'o1',
      _openid: 'oME',
      status: 'paid',
      amount: 178,
      goods: 198,
      createdAt: 1000,
      address: { name: '张三', phone: '138', region: 'x', detail: 'y' },
      items: [{ productId: 'p1', lineId: 'p1__基础款', spec: '基础款', name: '小鸭', price: 198, qty: 1, refundable: true }],
      ...over,
    },
  ])

beforeEach(() => {
  control.reset()
  control.setOpenId('oME')
})

describe('applyRefund（黄金：云端分摊·一行一售后·数量级·封顶）', () => {
  it('大白话：他人订单表现为不存在；待支付单不可申请；不在单内的商品拒', async () => {
    seedOrder()
    control.setOpenId('oOTHER')
    expect((await call('applyRefund', { orderId: 'o1', lineId: 'p1__基础款' })).error).toBe('NOT_FOUND')
    control.setOpenId('oME')
    seedOrder({ _id: 'oP', id: 'oP', status: 'pending' } as any)
    expect((await call('applyRefund', { orderId: 'oP', lineId: 'p1__基础款' })).error).toContain('BAD_STATUS')
    expect((await call('applyRefund', { orderId: 'o1', lineId: 'nope' })).error).toContain('UNKNOWN_ITEM')
  })

  it('大白话：同单售后记录多到扫描上限时 fail-closed 拒退（深审 P2·裸 .get() 默认 100 条截断会少算 used 令封顶失效）', async () => {
    control.setOpenId('oME')
    seedOrder()
    // 造满 AFTERSALE_SCAN_CAP（1000）条同单售后：无 .limit(1000) 时桩按真 SDK 默认截断到 100、length<1000、
    // 不触发 fail-closed（且 used 被少算）；显式取到上界才能看见记录数异常并拒退。
    control.seed(
      'afterSales',
      Array.from({ length: 1000 }, (_, i) => ({ _id: 'o1__x' + i, orderId: 'o1', status: 'rejected', refundAmount: 0 }))
    )
    expect((await call('applyRefund', { orderId: 'o1', lineId: 'p1__基础款' })).error).toBe('REFUND_SCAN_CAP')
  })

  it('大白话：退款额云端按占比分摊（不信前端金额）；单品订单退额=全额实付', async () => {
    seedOrder()
    const r = await call('applyRefund', { orderId: 'o1', lineId: 'p1__基础款', refundAmount: 99999 })
    expect(r.ok).toBe(true)
    expect(r.afterSale.refundAmount).toBe(178) // 分摊后=实付全额，前端伪造金额无效
    expect(r.afterSale._id).toBe('o1__p1__基础款')
    // 案 A 真根因：_id 含中文 spec（基础款），但存库的 outRefundNo 必须是微信合规单号（ASCII·≤64·确定派生）
    expect(r.afterSale._id).toContain('基础款')
    expect(r.afterSale.outRefundNo).toBe(refundNoFor('o1__p1__基础款'))
    expect(isValidRefundNo(r.afterSale.outRefundNo)).toBe(true)
  })

  it('大白话：一单一行一售后——重复申请拒；同商品不同规格各自可申请；同单累计封顶实付', async () => {
    control.seed('orders', [
      {
        _id: 'o2',
        id: 'o2',
        _openid: 'oME',
        status: 'paid',
        amount: 396,
        goods: 416,
        address: {},
        items: [
          { productId: 'p1', lineId: 'p1__红', spec: '红', name: '鸭', price: 208, qty: 1, refundable: true },
          { productId: 'p1', lineId: 'p1__蓝', spec: '蓝', name: '鸭', price: 208, qty: 1, refundable: true },
        ],
      },
    ])
    const r1 = await call('applyRefund', { orderId: 'o2', lineId: 'p1__红' })
    expect(r1.ok).toBe(true)
    expect((await call('applyRefund', { orderId: 'o2', lineId: 'p1__红' })).error).toBe('ALREADY_APPLIED')
    const r2 = await call('applyRefund', { orderId: 'o2', lineId: 'p1__蓝' })
    expect(r2.ok).toBe(true)
    // 累计封顶：两行分摊之和 ≤ 实付 396
    expect(r1.afterSale.refundAmount + r2.afterSale.refundAmount).toBeLessThanOrEqual(396)
  })

  it('大白话：进课失退货权的行拒退；买 N 进 M 只退剩余件的钱', async () => {
    seedOrder({
      _id: 'o3',
      id: 'o3',
      amount: 574, // 198×3 − 20
      goods: 594,
      items: [{ productId: 'p1', lineId: 'p1__基础款', spec: '基础款', name: '鸭', price: 198, qty: 3, enteredQty: 1, refundable: true }],
    } as any)
    const r = await call('applyRefund', { orderId: 'o3', lineId: 'p1__基础款' })
    expect(r.ok).toBe(true)
    expect(r.afterSale.qty).toBe(2) // 剩余可退 2 件
    expect(r.afterSale.refundAmount).toBeLessThan(574) // 只退 2 件的分摊额

    seedOrder({
      _id: 'o4',
      id: 'o4',
      items: [{ productId: 'p1', lineId: 'p1__基础款', spec: '基础款', name: '鸭', price: 198, qty: 1, refundable: false }],
    } as any)
    expect((await call('applyRefund', { orderId: 'o4', lineId: 'p1__基础款' })).error).toBe('NOT_REFUNDABLE')
  })
})

describe('refundCallback（黄金：防伪·核验 fail-closed·幂等·回补规则）', () => {
  const seedAS = (over: Record<string, unknown> = {}) =>
    control.seed('afterSales', [
      {
        _id: 'o1__p1__基础款',
        orderId: 'o1',
        _openid: 'oME',
        lineId: 'p1__基础款',
        productId: 'p1',
        spec: '基础款',
        qty: 1,
        refundAmount: 178,
        status: 'applied',
        appliedAt: 2000,
        ...over,
      },
    ])
  const SUCCESS = {
    out_refund_no: 'o1__p1__基础款',
    out_trade_no: 'o1',
    refund_status: 'SUCCESS',
    transaction_id: 'wx-rf',
    amount: { refund: 17800 },
  }

  it('大白话：带用户身份的伪造回调不改状态；成功回调置已退款留退款交易号，重复通知幂等', async () => {
    seedOrder()
    seedAS()
    control.setOpenId('oFAKE')
    await cb(SUCCESS)
    expect(control.dump('afterSales')[0].status).toBe('applied')

    control.setOpenId('')
    await cb(SUCCESS)
    const as1 = control.dump('afterSales')[0]
    expect(as1.status).toBe('refunded')
    expect(as1.refundTransactionId).toBe('wx-rf')
    const t1 = as1.refundedAt
    await cb({ ...SUCCESS, transaction_id: 'wx-rf2' })
    expect(control.dump('afterSales')[0].refundTransactionId).toBe('wx-rf') // 幂等不改写
    expect(control.dump('afterSales')[0].refundedAt).toBe(t1)
  })

  it('大白话：核验 fail-closed——单号或金额不符不置已退款、留对账痕；非成功状态留痕不翻态；未知售后单确认不抛', async () => {
    control.setOpenId('')
    seedOrder()
    seedAS()
    await cb({ ...SUCCESS, amount: { refund: 1 } }) // 金额不符
    let as1 = control.dump('afterSales')[0]
    expect(as1.status).toBe('applied')
    expect(as1.refundMismatch).toBe(true)

    await cb({ ...SUCCESS, out_trade_no: 'oWRONG' }) // 单号不符
    expect(control.dump('afterSales')[0].status).toBe('applied')

    await cb({ ...SUCCESS, refund_status: 'CLOSED' }) // 非成功
    as1 = control.dump('afterSales')[0]
    expect(as1.status).toBe('applied')
    expect(as1.refundStatus).toBe('CLOSED')

    expect(await cb({ out_refund_no: 'ghost', refund_status: 'SUCCESS' })).toEqual({ errcode: 0, errmsg: 'OK' })
  })

  it('大白话：退款成功后——未发货单回补库存；已发货单不回补（实物已出库，回补=幻影超卖）', async () => {
    control.setOpenId('')
    // 未发货（paid）→ 回补
    seedOrder()
    seedAS()
    control.seed('inventory', [{ _id: 'p1__基础款', productId: 'p1', spec: '基础款', stock: 0 }])
    await cb(SUCCESS)
    expect(control.dump('inventory')[0].stock).toBe(1)
    // 对账痕按 lineId 键控（深审 P3）：同商品多 SKU 分别退款各占一键、不互相覆盖
    expect(
      control.dump('orders')[0]['refunded.p1__基础款'] ?? control.dump('orders')[0].refunded?.['p1__基础款']
    ).toBeTruthy() // 订单留对账痕（键=lineId）

    // 已发货（shipped）→ 不回补
    seedOrder({ _id: 'o9', id: 'o9', status: 'shipped' } as any)
    seedAS({ _id: 'o9__p1', orderId: 'o9', lineId: 'p1', qty: 1 } as any)
    control.seed('inventory', [{ _id: 'p1__', productId: 'p1', spec: '', stock: 0 }])
    await cb({ ...SUCCESS, out_refund_no: 'o9__p1', out_trade_no: 'o9' })
    expect(control.dump('afterSales').find((a: any) => a._id === 'o9__p1').status).toBe('refunded')
    expect(control.dump('inventory').find((x: any) => x._id === 'p1__').stock).toBe(0) // 未回补
  })

  it('大白话：同商品两个 SKU 行分别退款——对账痕按 lineId 各占一键、不互相覆盖（深审 P3）', async () => {
    control.setOpenId('')
    // 同一 productId=p1、两个 SKU 行（红/蓝）各建一售后单
    control.seed('orders', [
      {
        _id: 'oM',
        id: 'oM',
        _openid: 'oME',
        status: 'paid',
        amount: 400,
        goods: 400,
        createdAt: 1000,
        address: { name: '张三', phone: '138', region: 'x', detail: 'y' },
        items: [
          { productId: 'p1', lineId: 'p1__红', spec: '红', name: '鸭', price: 200, qty: 1, refundable: true },
          { productId: 'p1', lineId: 'p1__蓝', spec: '蓝', name: '鸭', price: 200, qty: 1, refundable: true },
        ],
      },
    ])
    control.seed('afterSales', [
      { _id: 'oM__p1__红', orderId: 'oM', _openid: 'oME', lineId: 'p1__红', productId: 'p1', spec: '红', qty: 1, refundAmount: 200, status: 'approved', outRefundNo: refundNoFor('oM__p1__红') },
      { _id: 'oM__p1__蓝', orderId: 'oM', _openid: 'oME', lineId: 'p1__蓝', productId: 'p1', spec: '蓝', qty: 1, refundAmount: 200, status: 'approved', outRefundNo: refundNoFor('oM__p1__蓝') },
    ])
    await cb({ ...SUCCESS, out_refund_no: refundNoFor('oM__p1__红'), out_trade_no: 'oM', amount: { refund: 20000 } })
    await cb({ ...SUCCESS, out_refund_no: refundNoFor('oM__p1__蓝'), out_trade_no: 'oM', amount: { refund: 20000 } })
    const o = control.dump('orders')[0]
    const traceRed = o['refunded.p1__红'] ?? o.refunded?.['p1__红']
    const traceBlue = o['refunded.p1__蓝'] ?? o.refunded?.['p1__蓝']
    expect(traceRed).toBe(200) // 两行痕并存——旧版按 productId 键会只剩一行
    expect(traceBlue).toBe(200)
  })

  it('大白话：回调按 outRefundNo 字段反查命中——中文 _id 的售后单也能被认领置已退款（案 A 解耦·根因#12）', async () => {
    control.setOpenId('')
    seedOrder()
    // 售后单 _id 含中文（真实 SKU spec），微信回调带的是合规 outRefundNo（非 _id）——须按字段命中
    const rn = refundNoFor('o1__p1__基础款')
    control.seed('afterSales', [
      { _id: 'o1__p1__基础款', orderId: 'o1', _openid: 'oME', lineId: 'p1__基础款', spec: '基础款', productId: 'p1', qty: 1, refundAmount: 178, status: 'approved', appliedAt: 2000, outRefundNo: rn },
    ])
    await cb({ out_refund_no: rn, out_trade_no: 'o1', refund_status: 'SUCCESS', transaction_id: 'wx-rf', amount: { refund: 17800 } })
    const as1 = control.dump('afterSales')[0]
    expect(as1.status).toBe('refunded')
    expect(as1.refundTransactionId).toBe('wx-rf')
  })
})

describe('confirmReceive / 订单与售后读（黄金：属主隔离·游标分页·不泄露存在性）', () => {
  it('大白话：只有已发货能确认收货置完成；越状态/重复确认拒', async () => {
    seedOrder({ status: 'shipped' })
    const r = await call('confirmReceive', { id: 'o1' })
    expect(r.ok).toBe(true)
    expect(control.dump('orders')[0].status).toBe('done')
    expect((await call('confirmReceive', { id: 'o1' })).error).toContain('BAD_STATUS:done')
  })

  it('大白话：订单/售后列表只回本人、倒序、游标翻页不重不漏；按单号查他人单与不存在单都是 NOT_FOUND', async () => {
    control.seed(
      'orders',
      Array.from({ length: 12 }, (_, i) => ({
        _id: 'm' + i,
        id: 'm' + i,
        _openid: i % 2 ? 'oME' : 'oOTHER',
        status: 'paid',
        createdAt: 1000 + i,
      }))
    )
    const p1 = await call('getMyOrders', { limit: 3 })
    expect(p1.list.every((o: any) => o._openid === 'oME')).toBe(true)
    expect(p1.list[0].createdAt).toBeGreaterThan(p1.list[2].createdAt)
    const p2 = await call('getMyOrders', { limit: 3, cursor: p1.nextCursor })
    const ids = new Set([...p1.list, ...p2.list].map((o: any) => o._id))
    expect(ids.size).toBe(6)
    expect(p2.hasMore).toBe(false)

    expect((await call('getOrderById', { id: 'm0' })).error).toBe('NOT_FOUND') // 他人单
    expect((await call('getOrderById', { id: 'ghost' })).error).toBe('NOT_FOUND') // 不存在
    expect((await call('getOrderById', { id: 'm1' })).ok).toBe(true) // 本人单

    control.seed('afterSales', [
      { _id: 'a1', _openid: 'oME', orderId: 'm1', status: 'applied', appliedAt: 1 },
      { _id: 'a2', _openid: 'oOTHER', orderId: 'm0', status: 'applied', appliedAt: 2 },
    ])
    const as = await call('getMyAfterSales')
    expect(as.list.length).toBe(1)
    expect(as.list[0]._id).toBe('a1')
  })
})

describe('refundNoFor（微信退款单号契约·根因#12·2026-07-05 案 A 真根因）', () => {
  const WX_RE = /^[0-9a-zA-Z_|*@-]{1,64}$/
  it('大白话：含中文 spec / 超 64 长 / 空 的内部 _id 一律产出微信合规单号（ASCII·≤64·匹配平台正则）', () => {
    // 案 A 复现：这个 _id 直接当 out_refund_no → 微信 PARAM_ERROR「字符串必须匹配 ^[0-9a-zA-Z_|*@-]{1,64}$」
    expect(refundNoFor('2026070413019480__pmq8yfwvp__sku测试文案')).toMatch(WX_RE)
    expect(refundNoFor('o1__' + 'p1__超长规格名'.repeat(20))).toMatch(WX_RE) // 远超 64 字
    expect(refundNoFor('')).toMatch(WX_RE) // 空也不产非法/空单号
    expect(refundNoFor('2026061410421688__pmq8yfwvp')).toMatch(WX_RE) // 纯 ASCII 老单也合规
    expect(isValidRefundNo(refundNoFor('任意__中文__x'))).toBe(true)
  })
  it('大白话：确定性（同 _id 同号·幂等重试不会开二次退款）+ 唯一（不同行不同号）', () => {
    const a = '2026070413019480__pmq8yfwvp__红'
    expect(refundNoFor(a)).toBe(refundNoFor(a)) // 确定：审批重试打款单号不变（微信按单号幂等）
    expect(refundNoFor(a)).not.toBe(refundNoFor('2026070413019480__pmq8yfwvp__蓝')) // 唯一：同单不同 SKU 各自号
  })
})

import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main } from '../../packages/cloud/src/functions/orders/applyRefund'

// applyRefund 闸门（链10）：openid 本人 + 订单 paid/shipped/done + 商品在单内 +
// 条目 refundable + 一单一品一售后 + 金额云端分摊（占位券按比例摊、累计不超实付）。
beforeEach(() => {
  control.reset()
  control.setOpenId('user-A')
  control.seed('orders', [
    {
      _id: 'o1',
      id: 'o1',
      _openid: 'user-A',
      status: 'paid',
      goods: 198, // 礼盒 198
      amount: 178, // 实付 = 198 - 20 券
      address: { name: '陈圆圆', phone: '138' },
      items: [{ productId: 'prod-1', name: '幸运小鸭礼盒', spec: '经典暖黄', price: 198, qty: 1, refundable: true }],
    },
    {
      _id: 'o2',
      id: 'o2',
      _openid: 'user-A',
      status: 'shipped',
      goods: 227, // 198 + 29
      amount: 207,
      address: { name: '陈圆圆', phone: '138' },
      items: [
        { productId: 'prod-1', name: '礼盒', spec: '', price: 198, qty: 1, refundable: false }, // 已进课失权
        { productId: 'yarn', name: '棉线包', spec: '', price: 29, qty: 1, refundable: true },
      ],
    },
    { _id: 'o3', id: 'o3', _openid: 'user-A', status: 'pending', goods: 198, amount: 178, items: [] },
  ])
})

describe('applyRefund 闸门与金额分摊', () => {
  it('NO_OPENID / BAD_ARGS', async () => {
    control.setOpenId('')
    expect((await main({ orderId: 'o1', productId: 'prod-1' })).error).toBe('NO_OPENID')
    control.setOpenId('user-A')
    expect((await main({ orderId: 'o1' })).error).toBe('BAD_ARGS')
  })

  it('NOT_FOUND：他人订单不能申请', async () => {
    control.setOpenId('user-B')
    expect((await main({ orderId: 'o1', productId: 'prod-1' })).error).toBe('NOT_FOUND')
  })

  it('BAD_STATUS：待支付订单不能申请', async () => {
    expect((await main({ orderId: 'o3', productId: 'prod-1' })).error).toBe('BAD_STATUS:pending')
  })

  it('UNKNOWN_ITEM / NOT_REFUNDABLE（进课失权的条目拒绝）', async () => {
    expect((await main({ orderId: 'o1', productId: 'nope' })).error).toBe('UNKNOWN_ITEM:nope')
    expect((await main({ orderId: 'o2', productId: 'prod-1' })).error).toBe('NOT_REFUNDABLE')
  })

  it('单品订单：退款额 = 全额实付；快照/联系字段落库', async () => {
    const res = await main({ orderId: 'o1', productId: 'prod-1', reason: '不想要了' })
    expect(res.ok).toBe(true)
    expect(res.afterSale.refundAmount).toBe(178) // 占位券摊给唯一商品 → 全额实付
    const saved = control.dump('afterSales')[0]
    expect(saved._id).toBe('o1__prod-1')
    expect(saved.status).toBe('applied')
    expect(saved.phone).toBe('138')
    expect(saved.reason).toBe('不想要了')
  })

  it('多品订单按比例分摊，同单累计不超实付', async () => {
    // yarn 占 29/227 → round(20700 × 2900/22700) = 2644 分 = 26.44 元
    const r1 = await main({ orderId: 'o2', productId: 'yarn' })
    expect(r1.ok).toBe(true)
    expect(r1.afterSale.refundAmount).toBe(26.44)
  })

  it('ALREADY_APPLIED：一单一品一售后（库级唯一）', async () => {
    await main({ orderId: 'o1', productId: 'prod-1' })
    expect((await main({ orderId: 'o1', productId: 'prod-1' })).error).toBe('ALREADY_APPLIED')
  })

  it('同商品多 SKU：两行按 lineId 各自申请售后（外审 P1.1·不再撞 _id）', async () => {
    control.seed('orders', [
      {
        _id: 'o4', id: 'o4', _openid: 'user-A', status: 'paid', goods: 396, amount: 396,
        address: { name: 'x', phone: '138' },
        items: [
          { productId: 'kit-1', lineId: 'kit-1__红', name: '材料包', spec: '红', price: 198, qty: 1, refundable: true },
          { productId: 'kit-1', lineId: 'kit-1__蓝', name: '材料包', spec: '蓝', price: 198, qty: 1, refundable: true },
        ],
      },
    ])
    const r1 = await main({ orderId: 'o4', lineId: 'kit-1__红' })
    const r2 = await main({ orderId: 'o4', lineId: 'kit-1__蓝' }) // 同 productId 第二 SKU 旧版会 ALREADY_APPLIED
    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(true)
    const saved = control.dump('afterSales').filter((a) => a.orderId === 'o4')
    expect(saved.map((a) => a._id).sort()).toEqual(['o4__kit-1__红', 'o4__kit-1__蓝'])
    expect(saved.every((a) => a.productId === 'kit-1' && a.lineId)).toBe(true)
  })

  it('旧订单无 lineId：传 productId 仍可退（读兼容·lineId 落库=productId·外审 P1.1）', async () => {
    const r = await main({ orderId: 'o1', productId: 'prod-1' })
    expect(r.ok).toBe(true)
    const saved = control.dump('afterSales')[0]
    expect(saved._id).toBe('o1__prod-1') // 旧形态确定性 _id 不变
    expect(saved.lineId).toBe('prod-1') // 有效键回退 productId
  })

  it('数量级退款：买3进1→退剩余2件·金额按2件摊·afterSale.qty=2（外审 P1.3）', async () => {
    control.seed('orders', [
      {
        _id: 'o6', id: 'o6', _openid: 'user-A', status: 'paid', goods: 594, amount: 594, // 3×198·无券
        address: { name: 'x', phone: '138' },
        items: [{ productId: 'kit-2', lineId: 'kit-2__', name: '材料包', spec: '', price: 198, qty: 3, enteredQty: 1, refundable: true }],
      },
    ])
    const r = await main({ orderId: 'o6', lineId: 'kit-2__' })
    expect(r.ok).toBe(true)
    expect(r.afterSale.qty).toBe(2) // 退剩余 2 件（不是整行 3 件）
    expect(r.afterSale.refundAmount).toBe(396) // 198×2·按件数摊（不再整行 594）
  })

  it('数量级退款：全部进课的行不可退（NOT_REFUNDABLE·外审 P1.3）', async () => {
    control.seed('orders', [
      {
        _id: 'o7', id: 'o7', _openid: 'user-A', status: 'paid', goods: 396, amount: 396,
        address: { name: 'x', phone: '138' },
        items: [{ productId: 'kit-3', lineId: 'kit-3__', name: '包', spec: '', price: 198, qty: 2, enteredQty: 2, refundable: false }],
      },
    ])
    expect((await main({ orderId: 'o7', lineId: 'kit-3__' })).error).toBe('NOT_REFUNDABLE')
  })

  it('NOTHING_LEFT：额度用尽不可再退', async () => {
    control.seed('afterSales', [
      { _id: 'o1__other', orderId: 'o1', status: 'refunded', refundAmount: 178 },
    ])
    expect((await main({ orderId: 'o1', productId: 'prod-1' })).error).toBe('NOTHING_LEFT')
  })
})

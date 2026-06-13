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

  it('NOTHING_LEFT：额度用尽不可再退', async () => {
    control.seed('afterSales', [
      { _id: 'o1__other', orderId: 'o1', status: 'refunded', refundAmount: 178 },
    ])
    expect((await main({ orderId: 'o1', productId: 'prod-1' })).error).toBe('NOTHING_LEFT')
  })
})

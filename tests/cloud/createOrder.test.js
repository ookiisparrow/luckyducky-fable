import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main } from '../../cloudfunctions/createOrder/index.js'

// createOrder 闸门：openid / 契约 / 云端定价（不信任前端价）/ SKU 校验 / 金额 / 地址白名单。
beforeEach(() => {
  control.reset()
  control.setOpenId('user-A')
  control.seed('products', [
    { _id: 'prod-1', id: 'prod-1', name: '幸运小鸭礼盒', tag: '送礼首选', price: 198, skus: [{ name: '雾霭蓝', price: 210 }] },
    { _id: 'prod-3', id: 'prod-3', name: '微笑小鸡', tag: '零基础', price: 128, skus: [] },
  ])
})

describe('createOrder 闸门', () => {
  it('NO_OPENID：未登录拒单', async () => {
    control.setOpenId('')
    expect(await main({ items: [{ id: 'prod-1', qty: 1 }] })).toEqual({ ok: false, error: 'NO_OPENID' })
  })

  it('EMPTY_ITEMS：空条目 / 非整数 qty 一律拒', async () => {
    expect((await main({ items: [] })).error).toBe('EMPTY_ITEMS')
    expect((await main({ items: [{ id: 'prod-1', qty: 0.5 }] })).error).toBe('EMPTY_ITEMS')
    expect((await main({ items: [{ id: 'prod-1', qty: 0 }] })).error).toBe('EMPTY_ITEMS')
  })

  it('UNKNOWN_ITEM：商品不在云端 products 整单拒', async () => {
    expect((await main({ items: [{ id: 'nope', qty: 1 }] })).error).toBe('UNKNOWN_ITEM:nope')
  })

  it('价格以云端为准：前端传伪造 price 被忽略', async () => {
    const res = await main({ items: [{ id: 'prod-1', qty: 2, price: 1 }], address: {} })
    expect(res.ok).toBe(true)
    expect(res.order.goods).toBe(198 * 2) // 用云端 198，不是前端的 1
    expect(res.order.amount).toBe(198 * 2 - 20) // - COUPON
  })

  it('SKU 命中：价格用云端 sku 价，规格名进快照 spec', async () => {
    const res = await main({ items: [{ id: 'prod-1', qty: 1, sku: '雾霭蓝' }], address: {} })
    expect(res.order.items[0].price).toBe(210)
    expect(res.order.items[0].spec).toBe('雾霭蓝')
  })

  it('UNKNOWN_SKU：传了云端不存在的规格整单拒', async () => {
    expect((await main({ items: [{ id: 'prod-1', qty: 1, sku: '不存在' }] })).error).toBe(
      'UNKNOWN_SKU:prod-1:不存在',
    )
  })

  it('ADDONS 搭配购：价格用云端硬编码表', async () => {
    const res = await main({ items: [{ id: 'yarn', qty: 1 }], address: {} })
    expect(res.order.items[0].price).toBe(29)
    expect(res.order.items[0].name).toContain('补充棉线包')
  })

  it('地址白名单：多余字段被丢弃，status=paid，订单落库', async () => {
    const res = await main({
      items: [{ id: 'prod-3', qty: 1 }],
      address: { name: '陈圆圆', phone: '138', region: '浙江', detail: 'xx', evil: '应被丢' },
    })
    expect(res.order.address).toEqual({ name: '陈圆圆', phone: '138', region: '浙江', detail: 'xx' })
    expect(res.order.status).toBe('paid')
    expect(res.order.paidAt).toBeGreaterThan(0)
    // 落库且写了 _openid（只能查到本人）
    const saved = control.dump('orders')
    expect(saved).toHaveLength(1)
    expect(saved[0]._openid).toBe('user-A')
  })
})

describe('createOrder PAY_MODE 开关（规格 §三）', () => {
  it('缺省（无 config 集合）= mock：直接 paid + paidAt（零回归）', async () => {
    const res = await main({ items: [{ id: 'prod-3', qty: 1 }], address: {} })
    expect(res.order.status).toBe('paid')
    expect(res.order.paidAt).toBeGreaterThan(0)
  })

  it('mode=mock 显式配置：行为同缺省', async () => {
    control.seed('config', [{ _id: 'pay', mode: 'mock' }])
    const res = await main({ items: [{ id: 'prod-3', qty: 1 }], address: {} })
    expect(res.order.status).toBe('paid')
  })

  it('mode=real：写 pending、不记 paidAt，等支付回调', async () => {
    control.seed('config', [{ _id: 'pay', mode: 'real', subMchId: '1900000000' }])
    const res = await main({ items: [{ id: 'prod-3', qty: 1 }], address: {} })
    expect(res.order.status).toBe('pending')
    expect(res.order.paidAt).toBeUndefined()
    const saved = control.dump('orders')[0]
    expect(saved.status).toBe('pending')
    expect(saved.paidAt).toBeUndefined()
  })
})

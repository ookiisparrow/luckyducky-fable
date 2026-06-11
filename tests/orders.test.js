import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { createOrder } from '@/api/order.js'
import { useOrdersStore } from '@/store/orders.js'
import { CATALOG } from '@/data/catalog.js'
import { COUPON, SHIP } from '@/data/checkout.js'
import { dateTime } from '@/utils/format.js'

beforeEach(() => setActivePinia(createPinia()))

// 测试环境无 wx.cloud → api 走本地回退，与云函数同一套规则（云端定价契约的镜像）
describe('orders api 本地回退（与云函数同规则）', () => {
  const payload = {
    items: [
      { id: 'prod-1', qty: 2 },
      { id: 'yarn', qty: 1 },
    ],
    address: { name: '陈圆圆', phone: '138', region: '浙江', detail: 'xx路', extra: '应被丢弃' },
  }

  it('金额云端式现算：goods/coupon/ship/amount 自洽，价格来自价表而非前端', async () => {
    const o = await createOrder(payload)
    const goods = CATALOG['prod-1'].price * 2 + 29
    expect(o.goods).toBe(goods)
    expect(o.amount).toBe(Math.max(0, goods + SHIP - COUPON))
    expect(o.coupon).toBe(COUPON)
  })

  it('条目是快照：带 name/spec/price/refundable，地址只收白名单字段', async () => {
    const o = await createOrder(payload)
    expect(o.items[0]).toMatchObject({
      productId: 'prod-1',
      name: CATALOG['prod-1'].name,
      spec: CATALOG['prod-1'].tag,
      refundable: true,
    })
    expect(o.address).toEqual({ name: '陈圆圆', phone: '138', region: '浙江', detail: 'xx路' })
    expect(o.status).toBe('paid')
    expect(o.id).toMatch(/^\d{16}$/)
  })

  it('契约拒单：空条目 / 非法 qty / 未知商品', async () => {
    await expect(createOrder({ items: [] })).rejects.toThrow('EMPTY_ITEMS')
    await expect(createOrder({ items: [{ id: 'prod-1', qty: 0.5 }] })).rejects.toThrow('EMPTY_ITEMS')
    await expect(createOrder({ items: [{ id: 'nope', qty: 1 }] })).rejects.toThrow('UNKNOWN_ITEM')
  })
})

describe('orders store', () => {
  it('create 后 getById 取到同一笔（提交→支付成功→详情贯通）', async () => {
    const store = useOrdersStore()
    const o = await store.create({ items: [{ id: 'prod-3', qty: 1 }], address: {} })
    expect(store.getById(o.id)).toBe(store.list[0])
    expect(store.getById(o.id).amount).toBe(CATALOG['prod-3'].price - COUPON)
  })

  it('load 与远端合并不丢本地回退单（测试环境远端为空列表）', async () => {
    const store = useOrdersStore()
    const o = await store.create({ items: [{ id: 'prod-4', qty: 1 }], address: {} })
    await store.load()
    expect(store.getById(o.id)).toBeTruthy()
  })

  it('confirmReceive：shipped 单确认收货翻 done 并记 doneAt（详情/列表响应式刷新）', async () => {
    const store = useOrdersStore()
    store.list = [{ id: 'x9', status: 'shipped', items: [] }]
    await store.confirmReceive('x9')
    expect(store.getById('x9').status).toBe('done')
    expect(store.getById('x9').doneAt).toBeGreaterThan(0)
  })

  it('countByStatus：按状态计数（「我」页角标 / 列表 tab 数据源）', async () => {
    const store = useOrdersStore()
    await store.create({ items: [{ id: 'prod-1', qty: 1 }], address: {} })
    await store.create({ items: [{ id: 'prod-2', qty: 1 }], address: {} })
    expect(store.countByStatus.paid).toBe(2) // 模拟支付：新单直接 paid（待发货）
    expect(store.countByStatus.pending).toBeUndefined()
    store.list = [...store.list, { id: 'x1', status: 'shipped', items: [] }]
    expect(store.countByStatus.shipped).toBe(1)
  })
})

describe('format.dateTime', () => {
  it('epoch 毫秒 → YYYY-MM-DD HH:mm；非法值返回空串', () => {
    expect(dateTime(new Date(2026, 5, 10, 9, 5).getTime())).toBe('2026-06-10 09:05')
    expect(dateTime(null)).toBe('')
    expect(dateTime('abc')).toBe('')
  })
})

describe('SKU 链路（本地回退镜像）', () => {
  it('带 sku 的条目：规格名进快照 spec', async () => {
    const o = await createOrder({
      items: [{ id: 'prod-1', qty: 1, sku: '雾霭蓝' }],
      address: {},
    })
    expect(o.items[0].spec).toBe('雾霭蓝')
  })
})

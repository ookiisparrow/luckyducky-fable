// 订单号撞上本人同一分钟的旧单（随机尾 4 位相同，约 1/9000）：add 撞号后读回看到的是旧单，
// 不能当成「本次写其实落库了」返回旧单号——用户会去付那张旧单，新单的库存预留也没有单子可回补。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as app } from '../src/functions/app/index'

const ADDR = { name: '张三', phone: '13800000000', region: '浙江·杭州', detail: 'xx 路 1 号' }
const call = (data: Record<string, unknown>) => app({ action: 'createOrder', data }) as Promise<any>
// 北京时间 2026-07-01 12:00:30；尾号 = floor(r*9000)+1000
const NOW = new Date('2026-07-01T04:00:30Z')
const OLD = '2026070112001900' // r=0.1
const NEW = '2026070112002800' // r=0.2

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  control.reset()
  control.setOpenId('oME')
  control.seed('products', [{ _id: 'p1', id: 'p1', name: '小鸭礼盒', price: 198, tag: '基础款' }])
  control.seed('inventory', [{ _id: 'p1__基础款', productId: 'p1', spec: '基础款', stock: 5 }])
  control.seed('config', [{ _id: 'pay', mode: 'real', flowId: 'flow-pay' }])
  // 同一分钟早些时候本人下过的单（已付）
  control.seed('orders', [
    { _id: OLD, id: OLD, _openid: 'oME', status: 'paid', amount: 9.9, goods: 9.9, items: [], reserved: [], createdAt: NOW.getTime() - 25_000 },
  ])
  // 第一次取号撞 OLD，之后换成 NEW
  let r = 0.1
  vi.spyOn(Math, 'random').mockImplementation(() => r)
  control.setBeforeAdd(async ({ coll }: any) => {
    if (coll === 'orders') r = 0.2
  })
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('createOrder：订单号撞上本人旧单', () => {
  it('大白话：换号重试建出新单并返回新单号，旧单原样不动，幂等键指向新单', async () => {
    const r = await call({ items: [{ id: 'p1', qty: 1 }], address: ADDR, idempotencyKey: 'k-collide' })
    expect(r.ok).toBe(true)
    expect(r.order.id).toBe(NEW)
    const orders = control.dump('orders')
    expect(orders.map((o: any) => o._id).sort()).toEqual([OLD, NEW])
    expect(orders.find((o: any) => o._id === OLD)).toMatchObject({ status: 'paid', amount: 9.9 })
    expect(orders.find((o: any) => o._id === NEW)).toMatchObject({ status: 'pending', amount: r.order.amount })
    expect(control.dump('inventory')[0].stock).toBe(4)
    expect(control.dump('orderIdempotency')[0].orderId).toBe(NEW)
  })

  it('大白话：撞号前那次写其实落库了（读回是本次写的内容）——仍按幂等返回这一单，不换号建第二张', async () => {
    control.setBeforeAdd(async ({ coll, data }: any) => {
      if (coll === 'orders' && data._id === NEW) {
        control.seed('orders', [data])
        throw new Error('SDK_TIMEOUT')
      }
    })
    vi.spyOn(Math, 'random').mockImplementation(() => 0.2)
    const r = await call({ items: [{ id: 'p1', qty: 1 }], address: ADDR })
    expect(r.ok).toBe(true)
    expect(r.order.id).toBe(NEW)
    expect(control.dump('orders').length).toBe(2)
    expect(control.dump('inventory')[0].stock).toBe(4)
  })
})

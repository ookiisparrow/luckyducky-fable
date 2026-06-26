import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { control } from 'wx-server-sdk'
import { reserveStock, restoreStock, setStock } from '../../packages/cloud/src/kit'
import { main as createOrder } from '../../packages/cloud/src/functions/orders/createOrder'
import { main as closeExpired } from '../../packages/cloud/src/functions/orders/closeExpiredOrders'

// 库存#1（根因#1/#2 并发正确性）：下单即预留·乐观 CAS 防超卖·超时/退款回补·不限量安全迁移。
// 守卫 order-reserves-stock 的 reverseTest。
const ADDR = { name: '陈圆圆', phone: '13800001234', region: '浙江杭州', detail: '未来路 1 号' }
const inv = (id) => control.dump('inventory').find((d) => d._id === id)

describe('库存原子原语（kit/inventory·乐观 CAS）', () => {
  beforeEach(() => control.reset())

  it('扣减成功 + 不限量(无文档)放行 + 任一不足整单回滚已扣', async () => {
    control.seed('inventory', [
      { _id: 'p1__红', productId: 'p1', spec: '红', stock: 5 },
      { _id: 'p2__蓝', productId: 'p2', spec: '蓝', stock: 1 },
    ])
    const r = await reserveStock([
      { productId: 'p1', spec: '红', qty: 2 }, // 可扣
      { productId: 'p3', spec: '默认', qty: 9 }, // 无文档=不限量·放行
      { productId: 'p2', spec: '蓝', qty: 3 }, // 不足→整单 false
    ])
    expect(r.ok).toBe(false)
    expect(r.short.productId).toBe('p2')
    expect(inv('p1__红').stock).toBe(5) // p1 已扣被回滚·不锁死
  })

  it('CAS 防超卖：最后一件两次预留只一个成功', async () => {
    control.seed('inventory', [{ _id: 'p1__红', productId: 'p1', spec: '红', stock: 1 }])
    const a = await reserveStock([{ productId: 'p1', spec: '红', qty: 1 }])
    const b = await reserveStock([{ productId: 'p1', spec: '红', qty: 1 }])
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(false)
    expect(inv('p1__红').stock).toBe(0)
  })

  it('restoreStock：回补加回（超时/退款）', async () => {
    control.seed('inventory', [{ _id: 'p1__红', productId: 'p1', spec: '红', stock: 3 }])
    await restoreStock([{ productId: 'p1', spec: '红', qty: 2 }])
    expect(inv('p1__红').stock).toBe(5)
  })
})

describe('setStock 管理端写库存（外审 P1.8·CAS 防覆盖并发预留）', () => {
  beforeEach(() => control.reset())

  it('过期 expectedUpdatedAt → 冲突·不覆盖并发预留（防超卖窗口）', async () => {
    // 管理员加载时看到 updatedAt=1000；保存前并发预留已把库存扣到 80、updatedAt 推进到 2000。
    control.seed('inventory', [{ _id: 'p1__红', productId: 'p1', spec: '红', stock: 80, updatedAt: 2000 }])
    const res = await setStock('p1', '红', 100, undefined, 1000) // 拿旧 updatedAt 写绝对值 100
    expect(res.ok).toBe(false)
    expect(res.conflict).toBe(true)
    expect(inv('p1__红').stock).toBe(80) // 并发预留扣减未被旧页面覆盖
  })

  it('expectedUpdatedAt 相符 → 落库', async () => {
    control.seed('inventory', [{ _id: 'p1__红', productId: 'p1', spec: '红', stock: 80, updatedAt: 2000 }])
    const res = await setStock('p1', '红', 120, undefined, 2000)
    expect(res.ok).toBe(true)
    expect(inv('p1__红').stock).toBe(120)
  })

  it('无 expectedUpdatedAt（上新/首设）→ 无条件 upsert', async () => {
    const res = await setStock('p9', '默认', 50) // 无文档·上新（无并发预留可踩）
    expect(res.ok).toBe(true)
    expect(inv('p9__默认').stock).toBe(50)
  })
})

describe('createOrder 库存预留 + 超时回补（端到端·库存#1）', () => {
  beforeEach(() => {
    control.reset()
    control.setOpenId('user-A')
    process.env.ALLOW_MOCK_PAY = '1'
    control.seed('products', [
      { _id: 'prod-1', id: 'prod-1', name: '幸运小鸭礼盒', tag: '送礼首选', price: 198, skus: [{ name: '雾霭蓝', price: 210 }] },
    ])
  })
  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.ALLOW_MOCK_PAY
  })

  it('OUT_OF_STOCK：库存 0 拒单', async () => {
    control.seed('inventory', [{ _id: 'prod-1__雾霭蓝', productId: 'prod-1', spec: '雾霭蓝', stock: 0 }])
    const r = await createOrder({ items: [{ id: 'prod-1', qty: 1, sku: '雾霭蓝' }], address: ADDR })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('OUT_OF_STOCK')
  })

  it('下单预留扣减 + reserved 记入订单', async () => {
    control.seed('inventory', [{ _id: 'prod-1__雾霭蓝', productId: 'prod-1', spec: '雾霭蓝', stock: 3 }])
    const r = await createOrder({ items: [{ id: 'prod-1', qty: 2, sku: '雾霭蓝' }], address: ADDR })
    expect(r.ok).toBe(true)
    expect(r.order.reserved).toEqual([{ productId: 'prod-1', spec: '雾霭蓝', qty: 2 }])
    expect(inv('prod-1__雾霭蓝').stock).toBe(1)
  })

  it('超时关单回补预留 + 幂等（再跑不重复回补）', async () => {
    control.setOpenId('') // 定时器/服务端触发
    control.seed('inventory', [{ _id: 'prod-1__雾霭蓝', productId: 'prod-1', spec: '雾霭蓝', stock: 1 }])
    control.seed('orders', [
      { _id: 'o1', id: 'o1', status: 'pending', createdAt: 0, reserved: [{ productId: 'prod-1', spec: '雾霭蓝', qty: 2 }] },
    ])
    const r1 = await closeExpired()
    expect(r1.closed).toBe(1)
    expect(inv('prod-1__雾霭蓝').stock).toBe(3) // 1 + 回补 2
    const r2 = await closeExpired() // 已 closed·不在查询内→不重复回补
    expect(r2.closed).toBe(0)
    expect(inv('prod-1__雾霭蓝').stock).toBe(3)
  })
})

// E2E·库存防超卖（跨订单抢占 + 混合行回滚）：钉「N 单抢同一件库存恰一单建成、库存归零不为负、败者整单无残留
// 扣减」与「混合行订单任一行不足→全单拒、已扣行恰好还原」。
// 桩限制（根因#8）：wx-server-sdk 内存桩是单线程顺序执行，Promise.all 并发只是「交错入微队列」的近似——
// 真并发争用/CAS 咬合只有真机能证；这里验的是 CAS 乐观锁的逻辑正确性（读-比对-写序列在交错下不超卖），
// 不等于压测层面的容量结论。
import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as app } from '../src/functions/app/index'

const call = (action: string, data: Record<string, unknown> = {}) => app({ action, data }) as Promise<any>
const ADDR = { name: '张三', phone: '13800000000', region: '浙江·杭州', detail: 'xx 路 1 号' }

beforeEach(() => {
  control.reset()
  control.setOpenId('oME')
  control.seed('config', [{ _id: 'pay', mode: 'real', flowId: 'flow-pay' }])
  control.seed('products', [
    { _id: 'p1', id: 'p1', name: '限量礼盒', price: 198, tag: '基础款' },
    { _id: 'pU', id: 'pU', name: '不限量小件', price: 50, tag: '' },
    { _id: 'p3', id: 'p3', name: '缺货件', price: 30, tag: '' },
  ])
})

describe('库存防超卖（E2E·抢占 + 混合行回滚）', () => {
  it('大白话：5 单抢库存=1 的同一 SKU——恰 1 单建成、库存归 0、败者整单拒无残留扣减', async () => {
    control.seed('inventory', [{ _id: 'p1__基础款', productId: 'p1', spec: '基础款', stock: 1 }])
    const N = 5
    const results = await Promise.all(
      Array.from({ length: N }, () => call('createOrder', { items: [{ id: 'p1', qty: 1 }], address: ADDR }))
    )
    const oks = results.filter((r) => r.ok)
    const fails = results.filter((r) => !r.ok)
    expect(oks.length).toBe(1) // 恰一单建成
    expect(fails.length).toBe(N - 1)
    expect(fails.every((r) => String(r.error).includes('OUT_OF_STOCK'))).toBe(true)
    expect(control.dump('inventory')[0].stock).toBe(0) // 归零·不为负
    expect(control.dump('inventory')[0].stock).toBeGreaterThanOrEqual(0)
    expect(control.dump('orders').length).toBe(1) // 库里只有胜者那一单·败者无残留
  })

  it('大白话：混合行订单（限量够 + 不限量 + 一行不足）——全单拒，已扣的限量行恰好整数还原', async () => {
    control.seed('inventory', [
      { _id: 'p1__基础款', productId: 'p1', spec: '基础款', stock: 5 }, // 够
      { _id: 'p3__', productId: 'p3', spec: '', stock: 0 }, // 不足
      // pU 无库存档＝不限量
    ])
    const r = await call('createOrder', {
      items: [
        { id: 'p1', qty: 2 }, // 先扣（5→3）
        { id: 'pU', qty: 1 }, // 不限量·不扣不计
        { id: 'p3', qty: 1 }, // 不足→整单回滚
      ],
      address: ADDR,
    })
    expect(r.error).toContain('OUT_OF_STOCK:p3') // 短缺条目指明
    expect(control.dump('inventory').find((x: any) => x._id === 'p1__基础款').stock).toBe(5) // 已扣行恰好还原
    expect(control.dump('inventory').find((x: any) => x._id === 'p3__').stock).toBe(0) // 不足行未被动到
    expect(control.dump('orders').length).toBe(0) // 不建单
  })

  it('大白话：单线程顺序模拟竞态——先扣光再抢，第二单确定性拒（CAS 序列在交错下不超卖·退化验证）', async () => {
    control.seed('inventory', [{ _id: 'p1__基础款', productId: 'p1', spec: '基础款', stock: 1 }])
    const a = await call('createOrder', { items: [{ id: 'p1', qty: 1 }], address: ADDR })
    const b = await call('createOrder', { items: [{ id: 'p1', qty: 1 }], address: ADDR })
    expect(a.ok).toBe(true)
    expect(b.error).toContain('OUT_OF_STOCK')
    expect(control.dump('inventory')[0].stock).toBe(0)
  })
})

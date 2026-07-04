// 订单与钱组映射（守卫 rw-admin-money-ui-golden）：看板近似诚实标注/警报有则必显无则不吓人/
// 订单行金额不符禁发入口收窄/售后行只待审核可裁决/脏档安全（与 mp 同口径）。
import { describe, it, expect } from 'vitest'
import { mapDashboard, mapOrderRows, mapRefundRows } from '../src/lib/mapMoney'

describe('看板映射', () => {
  it('大白话：成交额标「精确/近似」如实；异常有则必显（含单号）、无则一条不渲染；坏响应回 null 不渲染假看板', () => {
    const vm = mapDashboard({
      ok: true,
      stats: { users: 3, orders: 250, gmv: 258.5, codesTotal: 30, codesActivated: 5, learners: 2 },
      approx: { gmv: false },
      funnel: { ordered: 250, paid: 200, activated: 5 },
      txAlerts: { feeMismatch: ['o-bad'], refundMismatch: [], stuckRefunds: [] },
    })!
    expect(vm.cards.find((c) => c.label.includes('成交额'))).toMatchObject({ value: '¥258.50', note: '精确' })
    expect(vm.alerts).toEqual([{ label: '金额不符单', ids: ['o-bad'] }]) // 空类不渲染
    const clean = mapDashboard({ ok: true, stats: { users: 0 }, txAlerts: {} })!
    expect(clean.alerts).toEqual([]) // 无异常零警报
    expect(mapDashboard({ ok: false, error: 'X' })).toBeNull()
    expect(mapDashboard(null)).toBeNull()
  })
})

describe('订单行映射（发货入口收窄）', () => {
  it('大白话：只有「已付且金额相符」的单能点发货；金额不符标红禁发；发货后带运单号；脏档剔除', () => {
    const rows = mapOrderRows([
      { id: 'o1', status: 'paid', amount: 2, items: [{ name: '小熊', qty: 1 }], address: { name: '赵', phone: '186', region: '贵州', detail: 'x' }, createdAt: 1783046400000 },
      { id: 'o2', status: 'paid', feeMismatch: true, amount: 1, items: [] },
      { id: 'o3', status: 'shipped', amount: 3, items: [{ name: 'a', qty: 2 }, { name: 'b', qty: 1 }, { name: 'c', qty: 1 }], shipping: { trackingNo: 'SF123' } },
      { status: 'paid' },
      null,
    ])
    expect(rows).toHaveLength(3) // 脏档剔除
    expect(rows[0]).toMatchObject({ canShip: true, amountLabel: '¥2.00', count: 1 })
    expect(rows[0].address).toContain('贵州')
    expect(rows[1]).toMatchObject({ canShip: false, feeMismatch: true }) // 金额不符禁发
    expect(rows[2]).toMatchObject({ canShip: false, trackingNo: 'SF123' }) // 已发货不再发
    expect(rows[2].summary).toContain('等 3 件商品')
    expect(mapOrderRows('garbage')).toEqual([])
  })
})

describe('售后行映射（裁决入口收窄）', () => {
  it('大白话：只有待审核能同意/拒绝；金额恒两位；退什么带规格件数；脏档剔除', () => {
    const rows = mapRefundRows([
      { _id: 'a1', orderId: 'o1', status: 'applied', name: '小熊', spec: 'sku测试文案', qty: 1, refundAmount: 2, reason: '测试', appliedAt: 1783046400000 },
      { _id: 'a2', orderId: 'o2', status: 'refunded', name: 'x', qty: 1, refundAmount: 10 },
      { orderId: 'o3' },
    ])
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ canDecide: true, refundAmountLabel: '¥2.00' })
    expect(rows[0].what).toBe('小熊（sku测试文案） ×1')
    expect(rows[1].canDecide).toBe(false) // 已退款不可再裁决
  })
})

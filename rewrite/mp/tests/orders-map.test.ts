// 黄金 frontend-store §七（脏单归一防白屏/渲染访问点纵深防御/状态计数无假计数）+ §四（金额两位小数/
// 时间格式化非法回空）（守卫 rw-mp-orders-golden）。
import { describe, it, expect } from 'vitest'
import { mapOrder, mapOrders, itemsOf, countOf, countByStatus, statusLabel, dateTime } from '../lib/mapOrders'

const GOOD = {
  _id: '2026070412001234',
  id: '2026070412001234',
  status: 'paid',
  items: [
    { productId: 'p1', lineId: 'p1__', name: '小鸭', spec: '', price: 128, qty: 2, refundable: true },
    { productId: 'p2', lineId: 'p2__白', name: '小熊', spec: '白', price: 22.5, qty: 1, refundable: false },
  ],
  goods: 278.5,
  coupon: 20,
  ship: 0,
  amount: 258.5,
  address: { name: '张三', phone: '138', region: '广东', detail: '南山' },
  createdAt: 1783046400000,
  trackingNo: '',
}

describe('订单映射（黄金 §七：脏单归一·纵深防御）', () => {
  it('大白话：正常单全字段映射——状态中文、金额恒两位小数、件数合计、时间可读', () => {
    const vm = mapOrder(GOOD)!
    expect(vm.statusLabel).toBe('待发货')
    expect(vm.amountLabel).toBe('¥258.50') // 恒两位小数
    expect(vm.items[1].priceLabel).toBe('¥22.50')
    expect(vm.count).toBe(3)
    expect(vm.couponLabel).toBe('-¥20.00')
    expect(vm.shipLabel).toBe('包邮')
    expect(vm.createdAtLabel).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
    expect(JSON.stringify(vm)).not.toContain('undefined')
  })

  it('大白话：脏单不白屏——缺条目/条目 null/非数组一律归一空数组、件数 0、绝不抛错；裸脏档整行剔除', () => {
    for (const dirty of [{ id: 'o1' }, { id: 'o2', items: null }, { id: 'o3', items: '坏' }, { id: 'o5', items: 42 }, { id: 'o6', items: { not: 'array' } }, { id: 'o4', items: [null, {}, { name: '半条', qty: -1 }] }]) {
      expect(() => itemsOf(dirty)).not.toThrow()
      expect(countOf(dirty)).toBe(0)
      const vm = mapOrder(dirty)!
      expect(vm.items.filter((l) => l.qty > 0)).toEqual([])
    }
    expect(itemsOf(null)).toEqual([]) // 裸 null 也不抛
    expect(countOf(undefined)).toBe(0)
    const list = mapOrders([GOOD, { status: 'paid' }, null, '垃圾'])
    expect(list).toHaveLength(1) // 无 id 裸脏档剔除·不进列表
  })

  it('大白话：状态计数无假计数；未知状态回原串不冒充；非法时间戳回空串', () => {
    const vms = mapOrders([GOOD, { ...GOOD, id: 'b', status: 'pending' }, { ...GOOD, id: 'c', status: 'pending' }])
    expect(countByStatus(vms)).toEqual({ paid: 1, pending: 2 }) // 无 shipped 键·不出假 0 计数
    expect(statusLabel('refund_required')).toBe('退款处理中')
    expect(statusLabel('weird_status')).toBe('weird_status')
    expect(dateTime('abc')).toBe('')
    expect(dateTime(-5)).toBe('')
  })
})

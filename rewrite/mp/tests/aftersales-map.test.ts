// 黄金 orders-money 售后节前端半边（可申请口径与云端 applyRefund 一致）+ frontend-store §八
// （翻页去重·申请成功列表即时收窄由 applicableLines 排除已申请实现·非独立插头部函数）。
import { describe, it, expect } from 'vitest'
import { mapAfterSale, mapAfterSales, mergeAfterSales, applicableLines, asStatusLabel, refundBlock } from '../lib/mapAftersales'
import type { OrderLineVM } from '../lib/mapOrders'

const line = (over: Partial<OrderLineVM>): OrderLineVM => ({
  lineId: 'p1__',
  name: '小鸭',
  spec: '',
  priceLabel: '¥128.00',
  qty: 2,
  enteredQty: 0,
  refundable: true,
  cover: '',
  ...over,
})

describe('可申请行（与云端 applyRefund 同口径的入口收窄）', () => {
  it('大白话：只有已付/已发/完成的单能申请；不可退行、已全部开课的行、已申请过的行都不出现在入口', () => {
    const items = [
      line({}), // 可申请
      line({ lineId: 'p2__', refundable: false }), // 不可退
      line({ lineId: 'p3__', qty: 2, enteredQty: 2 }), // 全进课·剩余可退 0
      line({ lineId: 'p4__', qty: 3, enteredQty: 1 }), // 部分进课·仍可申请
      line({ lineId: 'p5__' }), // 已申请过
    ]
    const ok = applicableLines('paid', items, ['p5__'])
    expect(ok.map((l) => l.lineId)).toEqual(['p1__', 'p4__'])
    expect(applicableLines('pending', items, [])).toEqual([]) // 未付不可申请
    expect(applicableLines('closed', items, [])).toEqual([])
    // 旧单无 enteredQty（归一 0）＝整行可退
    expect(applicableLines('done', [line({ lineId: 'old__' })], [])).toHaveLength(1)
  })
})

describe('售后单映射与列表语义（黄金 §八）', () => {
  const REC = { _id: 'o1__p1__', orderId: 'o1', lineId: 'p1__', name: '小鸭', spec: '', qty: 1, refundAmount: 108.5, status: 'applied', appliedAt: 1783046400000, reason: '不想要了' }

  it('大白话：状态中文、退款额两位小数、时间可读；无标识裸脏档整行剔除', () => {
    const vm = mapAfterSale(REC)!
    expect(vm.statusLabel).toBe('申请中')
    expect(vm.refundAmountLabel).toBe('¥108.50')
    expect(vm.appliedAtLabel).toMatch(/^\d{4}-/)
    expect(asStatusLabel('refunded')).toBe('已退款')
    expect(asStatusLabel('weird')).toBe('weird') // 未知不冒充
    expect(mapAfterSales([REC, { status: 'applied' }, null, 42])).toHaveLength(1) // 脏档剔除
  })

  it('大白话：翻页追加去重不重复', () => {
    const p1 = mapAfterSales([REC, { ...REC, _id: 'a2', orderId: 'o2' }])
    const p2 = mapAfterSales([{ ...REC, _id: 'a2', orderId: 'o2' }, { ...REC, _id: 'a3', orderId: 'o3' }]) // 游标边界重复 a2
    const merged = mergeAfterSales(p1, p2)
    expect(merged.map((a) => a.id)).toEqual(['o1__p1__', 'a2', 'a3']) // 去重·顺序稳定
  })
})

describe('退款段置灰原因（激活课程后售后不再死路）', () => {
  it('大白话：有可退的行不置灰；全开课写「已开课的商品不支持退款」、全申请过写「已申请过」、两种都有写合并句', () => {
    expect(refundBlock('done', [line({})], [])).toBe('')
    expect(refundBlock('done', [line({ refundable: false }), line({ lineId: 'p2__', qty: 1, enteredQty: 1 })], [])).toBe('已开课的商品不支持退款')
    expect(refundBlock('done', [line({})], ['p1__'])).toBe('这件已申请过')
    expect(refundBlock('done', [line({ refundable: false }), line({ lineId: 'p2__' })], ['p2__'])).toBe('已开课或已申请过的商品不能再退款')
  })
})

describe('已拒绝的售后带拒绝理由', () => {
  it('大白话：云端下发 rejectReason 就映射出来；没有给空串', () => {
    const base = { _id: 'a1', orderId: 'o1', status: 'rejected' }
    expect(mapAfterSale({ ...base, rejectReason: '已超过售后期' })!.rejectReason).toBe('已超过售后期')
    expect(mapAfterSale(base)!.rejectReason).toBe('')
  })
})

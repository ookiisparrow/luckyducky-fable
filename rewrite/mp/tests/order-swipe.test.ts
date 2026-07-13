// 我的订单页手势滑动换 tab 纯逻辑守卫（mp-7fixes 批2）。
import { describe, it, expect } from 'vitest'
import { swipeDir, nextTabKey } from '../lib/orderSwipe'

const TABS = [
  { key: '', label: '全部' },
  { key: 'pending', label: '待支付' },
  { key: 'paid', label: '待发货' },
  { key: 'shipped', label: '待收货' },
  { key: 'done', label: '已完成' },
]

describe('swipeDir（抬指手势判定）', () => {
  it('大白话：横向位移刚好 60px 不触发（阈值须大于 60），61px 触发', () => {
    expect(swipeDir(-60, 0, 200)).toBe(0)
    expect(swipeDir(-61, 0, 200)).toBe(1)
    expect(swipeDir(60, 0, 200)).toBe(0)
    expect(swipeDir(61, 0, 200)).toBe(-1)
  })

  it('大白话：方向映射——手指左滑（dx<0）去右边下一个 tab（1）；手指右滑（dx>0）去左边上一个 tab（-1）', () => {
    expect(swipeDir(-100, 0, 200)).toBe(1)
    expect(swipeDir(100, 0, 200)).toBe(-1)
  })

  it('大白话：角度护栏——纵向位移太大（接近 45 度以上）不算横滑手势，判为滚动', () => {
    expect(swipeDir(100, 80, 200)).toBe(0) // |dx|=100 不足 1.5×|dy|=120
  })

  it('大白话：慢拖（耗时达到/超过 600ms）不触发，哪怕位移够大', () => {
    expect(swipeDir(-100, 0, 600)).toBe(0)
    expect(swipeDir(-100, 0, 599)).toBe(1)
  })
})

describe('nextTabKey（越界钳制 + 未知 key 兜底）', () => {
  it('大白话：已在最左（全部）再往左滑（dir=-1）→ null，不抖动', () => {
    expect(nextTabKey(TABS, '', -1)).toBeNull()
  })

  it('大白话：已在最右（已完成）再往右滑（dir=1）→ null，不抖动', () => {
    expect(nextTabKey(TABS, 'done', 1)).toBeNull()
  })

  it('大白话：currentKey 不在表内（异常态）→ null，不报错', () => {
    expect(nextTabKey(TABS, 'unknown', 1)).toBeNull()
  })

  it('大白话：正常向后移一格 / 向前移一格', () => {
    expect(nextTabKey(TABS, 'pending', 1)).toBe('paid')
    expect(nextTabKey(TABS, 'paid', -1)).toBe('pending')
  })

  it('大白话：从空 key（全部）向后滑到 pending', () => {
    expect(nextTabKey(TABS, '', 1)).toBe('pending')
  })
})

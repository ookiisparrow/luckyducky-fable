// 我的订单页手势滑动换 tab 纯逻辑守卫（mp-7fixes 批2）+ 真机修复守卫（2026-07-13：全高手势区 + 滑入动画）。
import { describe, it, expect } from 'vitest'
import { swipeDir, nextTabKey } from '../lib/orderSwipe'
import wxml from '../pages/order-list/order-list.wxml?raw'
import wxss from '../pages/order-list/order-list.wxss?raw'
import ts from '../pages/order-list/order-list.ts?raw'

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

// 真机修复守卫（2026-07-13·调试日志）：手势区必须盖满整屏、切 tab 有滑入动画。源码文本扫描（同 home-cards.test.ts 范式）。
describe('全高手势区（防「下半屏滑动无效」回归）', () => {
  it('大白话：手势绑在全高根 .coolist 上、不绑内层 .coolist-body（body 高度只到内容底、订单少时下半屏落在它外）', () => {
    const rootLine = wxml.match(/<view class="coolist"[^>]*>/)
    expect(rootLine).toBeTruthy()
    expect(rootLine![0]).toContain('bind:touchstart="onSwipeStart"')
    expect(rootLine![0]).toContain('bind:touchend="onSwipeEnd"')
    // body 不再自带手势绑定（挪到根了）
    const bodyLine = wxml.match(/<view class="coolist-body[^"]*"[^>]*>/)
    expect(bodyLine).toBeTruthy()
    expect(bodyLine![0]).not.toContain('touchstart')
  })

  it('大白话：.coolist 根有 min-height:100vh——手势区才真盖满整屏', () => {
    const body = wxss.match(/\.coolist\s*\{([^}]*)\}/)
    expect(body).toBeTruthy()
    expect(body![1]).toMatch(/min-height:\s*100vh/)
  })
})

describe('切 tab 滑入动画（用户真机要求补的动画）', () => {
  it('大白话：wxss 定义了两个方向的滑入 keyframe（anim-next 自右 / anim-prev 自左）', () => {
    expect(wxss).toMatch(/\.coolist-body\.anim-next/)
    expect(wxss).toMatch(/\.coolist-body\.anim-prev/)
    expect(wxss).toMatch(/@keyframes coolistSlideNext/)
    expect(wxss).toMatch(/@keyframes coolistSlidePrev/)
  })

  it('大白话：wxml 的 .coolist-body 挂 {{anim}} 动画类；ts 的 switchTab 按方向置 anim-next/anim-prev', () => {
    expect(wxml).toMatch(/class="coolist-body \{\{anim\}\}"/)
    expect(ts).toContain("'anim-next'")
    expect(ts).toContain("'anim-prev'")
    // reload 消费一次（onShow/翻页不动画）：_animDir 落地后清空
    expect(ts).toMatch(/const anim = this\._animDir/)
  })
})

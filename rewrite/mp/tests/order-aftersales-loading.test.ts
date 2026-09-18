// 订单详情 / 售后列表加载态须有骨架（夜间审计 2026-09-10 mp slice·根因#8）：
// loading 且无数据时不能三分支全假白屏，也不能整段空白。
import { describe, it, expect } from 'vitest'
import orderWxml from '../pages/order/order.wxml?raw'
import orderWxss from '../pages/order/order.wxss?raw'
import aftersalesWxml from '../pages/aftersales/aftersales.wxml?raw'
import aftersalesWxss from '../pages/aftersales/aftersales.wxss?raw'

describe('订单详情/售后列表加载骨架（根因#8·加载中不再整页空白）', () => {
  it('大白话：订单详情 loading 且还没数据时要画出骨架，不能三分支全假白屏', () => {
    expect(orderWxml).toMatch(/wx:elif="\{\{loading\}\}"/)
    expect(orderWxml).toContain('coord-skel')
    expect(orderWxss).toMatch(/coord-skel/)
    expect(orderWxss).toMatch(/ld-shimmer/)
  })
  it('大白话：售后列表首次加载（loading 且列表空）要画出骨架，中间不能空白', () => {
    expect(aftersalesWxml).toMatch(/wx:if="\{\{loading && !list\.length\}\}"/)
    expect(aftersalesWxml).toContain('ldas-skel')
    expect(aftersalesWxml).not.toContain('coas-order-img')
    expect(aftersalesWxss).toMatch(/ldas-skel/)
    expect(aftersalesWxss).toMatch(/ld-shimmer/)
    expect(aftersalesWxss).toMatch(/\.ldas-skel-block\s*\{[^}]*width:\s*120rpx/)
    expect(aftersalesWxss).toMatch(/\.ldas-skel-block\s*\{[^}]*height:\s*120rpx/)
  })
})

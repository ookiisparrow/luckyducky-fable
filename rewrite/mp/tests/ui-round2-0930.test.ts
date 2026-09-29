// UI 审查第二轮 15 问（2026-09-30·Claude Design「Lucky Ducky UI 审查 15 问」老板选定）第 1–7 题。
// 6a 状态名/灯/说明句的行为由 orders-map / aftersales-map / p-mp-order(-list)-page 等测试钉住，这里只管版式。
import { describe, it, expect, vi, afterEach } from 'vitest'
import { navBottom } from '../lib/ground'
import checkoutWxml from '../pages/checkout/checkout.wxml?raw'
import checkoutWxss from '../pages/checkout/checkout.wxss?raw'
import addressWxml from '../pages/address/address.wxml?raw'
import addressWxss from '../pages/address/address.wxss?raw'
import orderWxml from '../pages/order/order.wxml?raw'
import orderWxss from '../pages/order/order.wxss?raw'
import homeWxss from '../pages/home/home.wxss?raw'
import orderListWxml from '../pages/order-list/order-list.wxml?raw'
import orderListWxss from '../pages/order-list/order-list.wxss?raw'
import reviewsWxss from '../pages/reviews/reviews.wxss?raw'

let pageOpts: Record<string, any> = {}
;(globalThis as any).Page = (o: unknown) => {
  pageOpts = o as Record<string, any>
}
const live = (w: string) => w.replace(/<!--[\s\S]*?-->/g, '')
const rule = (s: string, sel: string) => {
  const i = s.indexOf('\n' + sel + ' {')
  expect(i, sel).toBeGreaterThanOrEqual(0)
  return s.slice(i, s.indexOf('}', i))
}

describe('1c 地址卡拆三行：省市区 13 灰 / 详细地址 17·600 墨 / 收件人 15 灰', () => {
  it('大白话：结算页、地址列表、订单详情三处同一结构，详细地址是全卡唯一重点', () => {
    const sets: Array<[string, string, string, string]> = [
      [checkoutWxml, checkoutWxss, 'co', 'co-who'],
      [addressWxml, addressWxss, 'ad', 'ad-name'],
      [orderWxml, orderWxss, 'od', 'od-who'],
    ]
    for (const [w, css, p, who] of sets) {
      const html = live(w)
      const iRegion = html.indexOf(`${p}-region`)
      const iDetail = html.indexOf(`${p}-detail`)
      const iWho = html.indexOf(who)
      expect(iRegion, p).toBeGreaterThan(-1)
      expect(iRegion < iDetail && iDetail < iWho, `${p} 顺序`).toBe(true)
      expect(rule(css, `.${p}-region`)).toContain('font-size: 13px')
      expect(rule(css, `.${p}-detail`)).toMatch(/font-size: 17px;[\s\S]*font-weight: 600;[\s\S]*color: var\(--v5-ink\)/)
      expect(rule(css, `.${who}`)).toMatch(/font-size: 15px;[\s\S]*color: var\(--v5-ink-2\)/)
    }
  })
})

describe('3a 首页买家秀截 3 行、整排等高、署名贴底', () => {
  it('大白话：正文最多 3 行，撑满剩余高度把署名推到底', () => {
    const q = rule(homeWxss, '.hm-rv-quote')
    expect(q).toContain('-webkit-line-clamp: 3')
    expect(q).toContain('flex: 1')
  })
})

describe('4b 「取消订单」墨字', () => {
  it('大白话：危险感只在按住时的红色进度里，平时是墨字', () => {
    expect(rule(orderListWxss, '.ol-danger')).toContain('color: var(--v5-ink)')
  })
})

describe('5a 订单列表页签固定在导航栏下方', () => {
  const g = globalThis as any
  const saved = g.wx
  afterEach(() => {
    g.wx = saved
  })
  it('大白话：页签条贴在导航栏下缘（状态栏 + 44），下面留 52 占位；滚动后才出分隔线', async () => {
    g.wx = { getWindowInfo: () => ({ statusBarHeight: 47, screenHeight: 844 }) }
    expect(navBottom()).toBe(91)
    expect(live(orderListWxml)).toMatch(/class="ol-tabs-bar \{\{scrolled \? 'ol-tabs-bar-line' : ''\}\}" style="top: \{\{navBottom\}\}px"/)
    expect(rule(orderListWxss, '.ol-tabs-bar')).toContain('position: fixed')
    expect(rule(orderListWxss, '.ol-tabs-space')).toContain('height: 52px')
    vi.resetModules()
    await import('../pages/order-list/order-list')
    const patches: Record<string, unknown>[] = []
    const p = { data: { scrolled: false }, setData: (x: Record<string, unknown>) => (patches.push(x), Object.assign(p.data, x)) }
    pageOpts.onPageScroll.call(p, { scrollTop: 0 })
    pageOpts.onPageScroll.call(p, { scrollTop: 120 })
    pageOpts.onPageScroll.call(p, { scrollTop: 300 })
    pageOpts.onPageScroll.call(p, { scrollTop: 0 })
    expect(patches).toEqual([{ scrolled: true }, { scrolled: false }]) // 只在跨过顶端时 setData
  })
})

describe('7b 评价页小字统一 13px', () => {
  it('大白话：分布条标签/标签计数/评价标签 13px；标签栏 40 宽、行高 19、行距 6', () => {
    expect(rule(reviewsWxss, '.rv-bar-lbl')).toMatch(/flex: 0 0 40px;[\s\S]*font-size: 13px/)
    expect(rule(reviewsWxss, '.rv-tag-n')).toContain('font-size: 13px')
    expect(rule(reviewsWxss, '.rv-itag')).toContain('font-size: 13px')
    expect(rule(reviewsWxss, '.rv-bar')).toContain('height: 19px')
    expect(rule(reviewsWxss, '.rv-bars')).toContain('gap: 6px')
    expect(reviewsWxss).not.toMatch(/font-size: 11px/)
  })
})

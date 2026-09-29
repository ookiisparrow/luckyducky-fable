// UI 审查 6 问（2026-09-29·Claude Design「Lucky Ducky UI 审查 6 问」老板选定 1c·2a·3a·4b·5b·6b）+ 结业页底栏遮挡修复。
import { describe, it, expect, afterEach } from 'vitest'
import { mapCatalog } from '../lib/mapLearning'
import { groundGap } from '../lib/ground'
import welcomeWxml from '../pages/welcome/welcome.wxml?raw'
import welcomeWxss from '../pages/welcome/welcome.wxss?raw'
import catalogWxml from '../pages/catalog/catalog.wxml?raw'
import catalogWxss from '../pages/catalog/catalog.wxss?raw'
import meWxml from '../pages/me/me.wxml?raw'
import reviewWxml from '../pages/review/review.wxml?raw'
import reviewWxss from '../pages/review/review.wxss?raw'
import orderListWxml from '../pages/order-list/order-list.wxml?raw'
import finishWxml from '../pages/finish/finish.wxml?raw'
import cartWxss from '../pages/cart/cart.wxss?raw'
import checkoutWxss from '../pages/checkout/checkout.wxss?raw'
import orderWxss from '../pages/order/order.wxss?raw'
import logisticsWxss from '../pages/logistics/logistics.wxss?raw'
import paysuccessWxss from '../pages/paysuccess/paysuccess.wxss?raw'
import finishWxss from '../pages/finish/finish.wxss?raw'
import meWxss from '../pages/me/me.wxss?raw'
import reviewEggWxss from '../pages/review/review.wxss?raw'
import aftersalesWxss from '../pages/aftersales/aftersales.wxss?raw'

const live = (w: string) => w.replace(/<!--[\s\S]*?-->/g, '')
const classOf = (wxml: string, marker: string): string => {
  const m = live(wxml).match(new RegExp(`class="([^"]*(?<![\\w-])${marker}(?![\\w-])[^"]*)"`))
  expect(m, `找不到 ${marker}`).toBeTruthy()
  return m![1]
}
const rule = (wxss: string, sel: string): string => {
  const i = wxss.indexOf(sel + ' {')
  expect(i, `缺 ${sel}`).toBeGreaterThanOrEqual(0)
  return wxss.slice(i, wxss.indexOf('}', i))
}

describe('1c 激活成功页：主键贴底 + 主图按屏高压矮', () => {
  it('大白话：主图高＝屏宽和 45% 屏高取小；W1 的「下一步」固定贴底并有等高占位', () => {
    expect(rule(welcomeWxss, '.wl-hero')).toContain('height: min(100vw, 45vh)')
    const w1 = live(welcomeWxml).match(/<block wx:elif="\{\{phase === 'result'\}\}">([\s\S]*?)<\/block>/)?.[1] ?? ''
    expect(w1).toMatch(/class="wl-dock-space"/)
    expect(w1).toMatch(/class="wl-dock wl-dock-fix"/)
    expect(rule(welcomeWxss, '.wl-dock-fix')).toContain('position: fixed')
  })
})

describe('2a 地面线留白：屏高 < 700 用 56，其余 120（按屏幕高度，同一台手机各页一致）', () => {
  const g = globalThis as any
  const saved = g.wx
  afterEach(() => {
    g.wx = saved
  })
  it('大白话：SE（667）收窄到 56；700 及以上 120；拿不到屏高按 120', () => {
    g.wx = { getWindowInfo: () => ({ screenHeight: 667, windowHeight: 600 }) }
    expect(groundGap()).toBe(56)
    g.wx = { getWindowInfo: () => ({ screenHeight: 700, windowHeight: 650 }) }
    expect(groundGap()).toBe(120)
    g.wx = { getWindowInfo: () => ({ screenHeight: 844, windowHeight: 760 }) }
    expect(groundGap()).toBe(120)
    g.wx = {}
    expect(groundGap()).toBe(120)
  })
  it('大白话：九处地面线页面不再写死 120px（售后页不再写死 84/88），统一走 groundGap', () => {
    for (const s of [cartWxss, checkoutWxss, orderWxss, logisticsWxss, paysuccessWxss, finishWxss, meWxss, reviewEggWxss]) expect(s).not.toMatch(/padding: 120px/)
    expect(aftersalesWxss).not.toMatch(/padding(-top)?: (84|88)px/)
  })
})

describe('3a 后台来的标题统一走黑体', () => {
  it('大白话：目录页章名/课时名、「我」页入口名挂 .t-sys；章名 600、课时名 400、当前课 600', () => {
    expect(classOf(catalogWxml, 'ct-ch-title')).toContain('t-sys')
    expect(classOf(catalogWxml, 'ct-name')).toContain('t-sys')
    expect(rule(catalogWxss, '.ct-ch-title')).toContain('font-weight: 600')
    expect(rule(catalogWxss, '.ct-name')).toContain('font-weight: 400')
    expect(rule(catalogWxss, '.ct-lesson.current .ct-name')).toContain('font-weight: 600')
    const rows = live(meWxml).match(/class="[^"]*me-row-t[^"]*"/g) ?? []
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) expect(r).toContain('t-sys')
  })
})

describe('4b 目录页续学位置写在主键上', () => {
  const COURSE = {
    chapters: [
      { id: 'ch1', lessons: [{ id: 'l1', name: '起针', segments: [{ id: 's1', hasVideo: true, dur: 60 }, { id: 's2', hasVideo: true, dur: 60 }] }] },
      { id: 'ch2', lessons: [{ id: 'l2', name: '收针', segments: [{ id: 's3', hasVideo: true, dur: 60 }, { id: 's4', hasVideo: true, dur: 60 }] }] },
    ],
  }
  it('大白话：没学过——主键用后台文案（resumeLabel 空）；学到第 2 课段落 2——「继续第 2 课 · 段落 2」', () => {
    expect(mapCatalog(COURSE, [], 'c1').resumeLabel).toBe('')
    const r = mapCatalog(COURSE, [{ courseId: 'c1', done: { s1: true }, last: { lessonId: 'l2', segmentId: 's4' }, updatedAt: 1 }], 'c1')
    expect(r.resumeLabel).toBe('继续第 2 课 · 段落 2')
  })
  it('大白话：只有完成记录没有 last——按续学目标（下一节首段）写；全部学完——回到后台文案', () => {
    expect(mapCatalog(COURSE, [{ courseId: 'c1', done: { s1: true, s2: true }, updatedAt: 1 }], 'c1').resumeLabel).toBe('继续第 2 课 · 段落 1')
    expect(mapCatalog(COURSE, [{ courseId: 'c1', done: { s1: true, s2: true, s3: true, s4: true }, updatedAt: 1 }], 'c1').resumeLabel).toBe('')
  })
  it('大白话：页面主键优先显示系统生成的续学位置', () => {
    expect(live(catalogWxml)).toContain('{{resumeLabel || resumeCta}}')
  })
})

describe('5b 写评价：固定约 4 行 + 字数计数，「＋」并入缩略图行', () => {
  it('大白话：框高 150；框下右侧 N/500，≥450 黄、满 500 红；「＋」在缩略图行最后一格', () => {
    expect(rule(reviewWxss, '.rv-text')).toContain('height: 150px')
    const w = live(reviewWxml)
    expect(w).toContain('{{text.length}}/500')
    expect(w).toMatch(/text\.length >= 500 \? 'rv-count-full' : text\.length >= 450 \? 'rv-count-warn'/)
    const photos = w.match(/<view class="rv-photos"[^>]*>([\s\S]*?)\n {8}<\/view>/)?.[1] ?? ''
    expect(photos).toMatch(/rv-add/)
  })
})

describe('6b 订单列表：「去支付」全用浅色键，墨黑留给详情页', () => {
  it('大白话：列表里没有墨黑键', () => {
    expect(live(orderListWxml)).not.toMatch(/k-ink/)
  })
})

describe('结业页底栏不遮内容', () => {
  it('大白话：固定底栏前有等高占位', () => {
    expect(live(finishWxml)).toMatch(/<view class="fn-dock-space"><\/view>\s*<view class="fn-dock"/)
  })
})

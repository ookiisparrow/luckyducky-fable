// 底栏只用像素图标、回顶键去文案（老板 2026-09-30·照 Claude Design「App v5 字重」稿 data-tabbar / backTop）；
// 底栏 2026-10-01 改照「App v6 Lite」5a 降存在感（交接说明 handoff/v6-lite-简化说明.md）。
import { describe, it, expect } from 'vitest'
import { live, rule } from './helpers/wxmlStatic'
import tabWxml from '../custom-tab-bar/index.wxml?raw'
import tabWxss from '../custom-tab-bar/index.wxss?raw'
import tabJson from '../custom-tab-bar/index.json?raw'
import tokens from '../styles/tokens.wxss?raw'
import homeWxml from '../pages/home/home.wxml?raw'
import homeWxss from '../pages/home/home.wxss?raw'
import { PIXEL_GLYPHS } from '../lib/pixelGlyph'

describe('底栏像素图标', () => {
  it('大白话：三个 tab 键只放像素图标，不写「首页 / 购物车 / 我」', () => {
    const w = live(tabWxml)
    expect(w).toMatch(/<px-i name="\{\{item\.id\}\}"/)
    expect(w).not.toMatch(/item\.label/)
    expect(JSON.parse(tabJson).usingComponents['px-i']).toBe('/components/px-i/px-i')
  })
  it('大白话（v6 Lite 5a）：三格全是平面键（不分选中/未选，没有浮起的浅色键帽）；当前那格图标紫、其余灰——「紫＝当前」，不加 LED', () => {
    const w = live(tabWxml)
    expect(w).not.toMatch(/k-light/)
    expect(w).toMatch(/class="k k-flat ld-tab"/)
    // 按下只淡一下：不用 k-flat-down（那是灰底 + 下沉，按下时又浮成键帽）
    expect(w).toMatch(/hover-class="press-fade"/)
    expect(w).not.toMatch(/k-flat-down/)
    // 平面键自带凹槽灰底，Tab 栏三格去掉底色和阴影
    const tab = rule(tabWxss, '.ld-tab')
    expect(tab).toContain('background: transparent;')
    expect(tab).toContain('box-shadow: none;')
    expect(w).toContain(`tone="{{active === item.id ? 'var(--v5-violet)' : 'var(--v5-ink-2)'}}"`)
    expect(w).not.toMatch(/name="led"/)
    expect(tokens).toMatch(/--v5-violet: #8a5ae0;/)
    expect(tokens).toMatch(/--v5-ink-2: #62625c;/)
  })
  it('大白话（v6 Lite 5a）：不显示购物车件数（角标/弹跳都去掉）', () => {
    expect(live(tabWxml)).not.toMatch(/cartCount|ld-tab-count|ld-tab-bump/)
    expect(tabWxss).not.toMatch(/ld-tab-count|ld-tab-bump/)
  })
  it('大白话（v6 Lite 5a）：底栏顶上一条 0.10 分隔线；底色、内边距（键高 44）不变', () => {
    const r = rule(tabWxss, '.ld-tabbar')
    expect(r).toContain('border-top: 1px solid var(--v5-hair-tab);')
    expect(tokens).toMatch(/--v5-hair-tab: rgba\(17, 17, 17, 0\.1\);/)
    expect(r).toContain('background: var(--v5-canvas);')
    expect(r).toContain('padding: 8px 16px max(24px, env(safe-area-inset-bottom));')
  })
  it('大白话：home / cart / me 三个图标点阵与设计稿 pixel-mini.js 一格不差', () => {
    expect(PIXEL_GLYPHS.home).toEqual(['....X....', '...XXX...', '..XXXXX..', '.XXXXXXX.', 'XXXXXXXXX', '.XX...XX.', '.XX.X.XX.', '.XX.X.XX.', '.XXXXXXX.'])
    expect(PIXEL_GLYPHS.cart).toEqual(['XX.......', '.X.......', '.XXXXXXXX', '.XX.....X', '.XX.....X', '.XXXXXXXX', '.X.......', '.XXXXXXX.', '..X...X..'])
    expect(PIXEL_GLYPHS.me).toEqual(['...XXX...', '..XXXXX..', '..XXXXX..', '..XXXXX..', '...XXX...', '.........', '.XXXXXXX.', 'XXXXXXXXX', 'XXXXXXXXX'])
  })
})

describe('回顶键', () => {
  it('大白话：只剩向上像素箭头、没有「顶部」字；36×36 方键', () => {
    const key = live(homeWxml).match(/<view wx:if="\{\{showTop\}\}"[^>]*hm-backtop[\s\S]*?<\/view>/)?.[0] ?? ''
    expect(key).toContain('<px-i name="up" />')
    expect(key).not.toMatch(/<text/)
    const r = rule(homeWxss, '.hm-backtop')
    expect(r).toContain('width: 36px;')
    expect(r).toContain('height: 36px;')
    expect(r).toContain('padding: 0;')
  })
})

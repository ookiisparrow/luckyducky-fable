// 底栏只用像素图标、回顶键去文案（老板 2026-09-30·照 Claude Design「App v5 字重」稿 data-tabbar / backTop）。
import { describe, it, expect } from 'vitest'
import tabWxml from '../custom-tab-bar/index.wxml?raw'
import tabJson from '../custom-tab-bar/index.json?raw'
import homeWxml from '../pages/home/home.wxml?raw'
import homeWxss from '../pages/home/home.wxss?raw'
import { PIXEL_GLYPHS } from '../lib/pixelGlyph'

const live = (w: string) => w.replace(/<!--[\s\S]*?-->/g, '')
const rule = (css: string, sel: string) => css.slice(css.indexOf('\n' + sel + ' {'), css.indexOf('}', css.indexOf('\n' + sel + ' {')))

describe('底栏像素图标', () => {
  it('大白话：三个 tab 键只放像素图标（跟按键字色），不再写「首页 / 购物车 / 我」；购物车件数角标照留', () => {
    const w = live(tabWxml)
    expect(w).toContain('<px-i name="{{item.id}}" />')
    expect(w).not.toMatch(/item\.label/)
    expect(w).toContain('ld-tab-count')
    expect(JSON.parse(tabJson).usingComponents['px-i']).toBe('/components/px-i/px-i')
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

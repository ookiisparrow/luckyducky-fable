// 品牌字体移植黄金（批4·mp-7fixes）：源码扫描式（仿 pages-map.test.ts 大白话风格）——
// 防将来断线：常量形状对/app.ts 真调用/token 变量存在且 WenYuan 打头/page 块真引用。
// rewrite/mp/tsconfig.json 无 @types/node，不走 node:fs+import.meta.url，改走 `?raw` 原文导入（见 raw-imports.d.ts）。
import { describe, it, expect } from 'vitest'
import { BRAND_FONT_FAMILY, BRAND_FONTS } from '../utils/brandFont'
import appSrc from '../app.ts?raw'
import tokensSrc from '../styles/tokens.wxss?raw'
import appWxssSrc from '../app.wxss?raw'

describe('brandFont 常量（BRAND_FONT_FAMILY / BRAND_FONTS）', () => {
  it('大白话：family 是文源圆体', () => {
    expect(BRAND_FONT_FAMILY).toBe('WenYuan Rounded SC')
  })

  it('大白话：两字重（500/700）各一，url 都指向 tcloudbaseapp 托管域名的 .woff（不是 .woff2）', () => {
    expect(BRAND_FONTS.length).toBe(2)
    const weights = BRAND_FONTS.map((f) => f.weight).sort()
    expect(weights).toEqual(['500', '700'])
    for (const { url } of BRAND_FONTS) {
      expect(url).toMatch(/^https:\/\/cloudbase-.*\.tcloudbaseapp\.com\/fonts\/.+\.woff$/)
      expect(url.endsWith('.woff2')).toBe(false)
    }
  })
})

describe('app.ts 接线（loadBrandFonts 真被调用）', () => {
  it('大白话：app.ts 源码里出现 loadBrandFonts() 调用', () => {
    expect(appSrc).toMatch(/loadBrandFonts\(\)/)
  })
})

describe('tokens.wxss / app.wxss 接线（--ld-font-brand 变量 + page 块真引用）', () => {
  it('大白话：tokens.wxss 定义 --ld-font-brand 且 WenYuan Rounded SC 打头', () => {
    const m = tokensSrc.match(/--ld-font-brand:\s*([^;]+);/)
    expect(m).toBeTruthy()
    expect(m![1].trim().startsWith("'WenYuan Rounded SC'")).toBe(true)
  })

  it('大白话：app.wxss 的 page 块引用了 var(--ld-font-brand)', () => {
    const pageBlock = appWxssSrc.match(/page\s*\{[^}]*\}/)
    expect(pageBlock).toBeTruthy()
    expect(pageBlock![0]).toContain('var(--ld-font-brand)')
  })

  it('大白话：page 块显式钉了 font-weight，且值命中 BRAND_FONTS 里已注册的字重（不留默认 400 空档）', () => {
    const pageBlock = appWxssSrc.match(/page\s*\{[^}]*\}/)
    expect(pageBlock).toBeTruthy()
    const m = pageBlock![0].match(/font-weight:\s*(\d+)/)
    expect(m).toBeTruthy()
    const registeredWeights = BRAND_FONTS.map((f) => f.weight)
    expect(registeredWeights).toContain(m![1])
  })
})

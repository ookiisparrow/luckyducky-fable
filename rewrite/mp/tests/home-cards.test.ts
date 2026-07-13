// 首页商品卡/买家秀卡等高不变量（2026-07-13 mp-7fixes 战役批1：用户指令「两种卡高度不一致要修」）。
// 源码扫描式：读 home.wxml/home.wxss 文本做字符串/正则断言（同 rewrite/cloud/tests/config-checklist.test.ts 的
// stripComments 范式，防 E1「裸写正则被注释文本假命中」）。仓内现无任何断言 wxml 结构的测试
//（rw-mp-home-golden 只测 lib/mapHome 纯函数）——本文件专责补上「等高」这条视觉不变量的机器守卫。
import { describe, it, expect } from 'vitest'
// rewrite/mp/tsconfig.json 是小程序端 CommonJS 严格配置、无 @types/node/import.meta，
// 故不走 node:fs+import.meta.url，改走 vitest 的 Vite 管线 `?raw` 原文导入（类型声明见 raw-imports.d.ts）。
import wxmlRaw from '../pages/home/home.wxml?raw'
import wxssRaw from '../pages/home/home.wxss?raw'

/** 剥 CSS 块注释（/* ... *\/）——防注释里出现同名属性字面量假命中。 */
function stripCssComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** 剥 wxml 注释（<!-- ... -->）——同上防假命中。 */
function stripWxmlComments(src: string): string {
  return src.replace(/<!--[\s\S]*?-->/g, '')
}

const wxml = stripWxmlComments(wxmlRaw)
const wxss = stripCssComments(wxssRaw)

/** 取指定顶层选择器的规则体（`.foo { ... }` 中花括号内文本）。 */
function ruleBody(css: string, selector: string): string {
  const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}')
  const m = css.match(re)
  if (!m) throw new Error(`未找到规则块：${selector}`)
  return m[1]
}

function extractHeightRpx(body: string): number {
  const m = body.match(/(?<!min-|max-|line-)height:\s*([\d.]+)rpx/)
  if (!m) throw new Error(`规则块内无 height: 声明——原文：${body}`)
  return Number(m[1])
}

describe('商品卡 tag 行恒渲染（消掉「有无 tag」的高度分叉）', () => {
  it('大白话：ld-prod-tag 节点不再用 wx:if 整行拆行，改用条件类占位，无 tag 时靠 CSS 隐藏而非不渲染', () => {
    const tagTag = wxml.match(/<view class="ld-prod-tag[^>]*>/)
    expect(tagTag).toBeTruthy()
    const tagLine = tagTag![0]
    expect(tagLine).not.toContain('wx:if')
    expect(tagLine).toContain('ld-prod-tag-empty')
  })

  it('大白话：.ld-prod-tag-empty 用 visibility:hidden 隐藏文字但保留占位高度（不是 display:none）', () => {
    const body = ruleBody(wxss, '.ld-prod-tag-empty')
    expect(body).toMatch(/visibility:\s*hidden/)
    expect(body).not.toMatch(/display:\s*none/)
  })
})

describe('两卡型外框等高（.ld-prod-card 与 .ld-review-card 固定同一 height）', () => {
  it('大白话：两个卡片外框都声明了固定 height，且数值完全相等', () => {
    const prodHeight = extractHeightRpx(ruleBody(wxss, '.ld-prod-card'))
    const reviewHeight = extractHeightRpx(ruleBody(wxss, '.ld-review-card'))
    expect(prodHeight).toBeGreaterThan(0)
    expect(prodHeight).toBe(reviewHeight)
  })
})

describe('两卡型图片 1:1 方形（2026-07-13 用户指令「商品卡图片应是一比一」·padding-top:100% 撑方·避 aspect-ratio 旧 WebView 不支持）', () => {
  it('大白话：.ld-prod-media 用 padding-top:100% 撑成正方形（不再写死非等宽 height）', () => {
    const body = ruleBody(wxss, '.ld-prod-media')
    expect(body).toMatch(/padding-top:\s*100%/)
    expect(body).not.toMatch(/(?<!min-|max-|line-)height:\s*[\d.]+rpx/) // 不再写死 300rpx 之类非等宽高
  })
  it('大白话：.ld-review-media 同步 1:1 方形（等高守卫联动·两卡内部算式一致不留空隙）', () => {
    const body = ruleBody(wxss, '.ld-review-media')
    expect(body).toMatch(/padding-top:\s*100%/)
    expect(body).not.toMatch(/(?<!min-|max-|line-)height:\s*[\d.]+rpx/)
  })
  it('大白话：两卡图片子节点绝对定位铺满方形容器（padding-top 撑高后子图须 absolute inset 填满）', () => {
    const prodImg = ruleBody(wxss, '.ld-prod-media-img')
    const reviewImg = ruleBody(wxss, '.ld-review-media-img')
    expect(prodImg).toMatch(/position:\s*absolute/)
    expect(reviewImg).toMatch(/position:\s*absolute/)
  })
})

describe('文字区多行裁剪三件套（-webkit-box/box-orient/line-clamp + overflow:hidden 齐全）', () => {
  it('大白话：.ld-prod-name（商品名）2 行裁剪三件套齐全', () => {
    const body = ruleBody(wxss, '.ld-prod-name')
    expect(body).toMatch(/display:\s*-webkit-box/)
    expect(body).toMatch(/-webkit-box-orient:\s*vertical/)
    expect(body).toMatch(/-webkit-line-clamp:\s*2/)
    expect(body).toMatch(/overflow:\s*hidden/)
  })

  it('大白话：.ld-review-quote（买家秀引用）3 行裁剪三件套齐全', () => {
    const body = ruleBody(wxss, '.ld-review-quote')
    expect(body).toMatch(/display:\s*-webkit-box/)
    expect(body).toMatch(/-webkit-box-orient:\s*vertical/)
    expect(body).toMatch(/-webkit-line-clamp:\s*3/)
    expect(body).toMatch(/overflow:\s*hidden/)
  })
})

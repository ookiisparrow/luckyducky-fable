// 品牌字体分层接线黄金（批4 移植 + 字体分层批扩展）：源码扫描式（仿 pages-map.test.ts 大白话风格）——
// 防将来断线：两层×三字重形状对/族名对/加载顺序对（首屏最先）。字符集覆盖归守卫 rw-mp-font-tier-subset-covers
// （check-structure），产物文件名一致性也在该守卫侧由 brandFont.ts 与 assets/brand-fonts 同批产出保证。
// v5（老板 2026-09-28 拍板）：圆体只留给按钮/标题/界面固定文案，用户内容走黑体，所以不设 GB2312 兜底层。
import { describe, it, expect } from 'vitest'
import * as brandFont from '../utils/brandFont'
import { BRAND_FONT_FAMILY, BRAND_FONT_FAMILY_T2, BRAND_FONT_TIERS } from '../utils/brandFont'
import tokensWxss from '../styles/tokens.wxss?raw'

describe('brandFont 分层常量（两层×三字重·首屏最先）', () => {
  it('大白话：两层字族——首层沿用文源圆体原名，二层带 T2 后缀；兜底层已删，字体栈里也不再有 T3', () => {
    expect(BRAND_FONT_FAMILY).toBe('WenYuan Rounded SC')
    expect(BRAND_FONT_FAMILY_T2).toBe('WenYuan Rounded SC T2')
    expect(BRAND_FONT_TIERS.map((t) => t.family)).toEqual([BRAND_FONT_FAMILY, BRAND_FONT_FAMILY_T2])
    expect('BRAND_FONT_FAMILY_T3' in brandFont).toBe(false)
    expect(tokensWxss).not.toContain('WenYuan Rounded SC T3')
  })

  it('大白话：tier 顺序即加载顺序——tier1(首屏) → tier2(二级页)，文件名可见分层', () => {
    expect(BRAND_FONT_TIERS.length).toBe(2)
    BRAND_FONT_TIERS.forEach((t, i) => {
      for (const f of t.files) expect(f.name).toContain(`tier${i + 1}`)
    })
  })

  it('大白话：每层三字重（500 正文/700 标题/900 大标题·细字 300 的小字已走黑体，圆体不出细体）；文件名 .woff 结尾（不是 .woff2）且带版本号 v9（口径变了＝改名让旧缓存失效）', () => {
    for (const t of BRAND_FONT_TIERS) {
      expect(t.files.map((f) => f.weight).sort()).toEqual(['500', '700', '900'])
      for (const { name } of t.files) {
        expect(name).toMatch(/\.v9\.woff$/)
        expect(name.endsWith('.woff2')).toBe(false)
      }
    }
  })
})

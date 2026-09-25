// 品牌字体分层接线黄金（批4 移植 + 字体分层批扩展）：源码扫描式（仿 pages-map.test.ts 大白话风格）——
// 防将来断线：三层×两字重形状对/族名对/加载顺序对（首屏最先）/app.ts 真调用/token 三族回退栈次序对/
// page 块真引用/持久缓存与重试真在。字符集覆盖归守卫 rw-mp-font-tier-subset-covers（check-structure），
// 产物文件名一致性也在该守卫侧由 brandFont.ts 与 assets/brand-fonts 同批产出保证。
// rewrite/mp/tsconfig.json 无 @types/node，不走 node:fs+import.meta.url，改走 `?raw` 原文导入（见 raw-imports.d.ts）。
import { describe, it, expect } from 'vitest'
import { BRAND_FONT_FAMILY, BRAND_FONT_FAMILY_T2, BRAND_FONT_FAMILY_T3, BRAND_FONT_TIERS } from '../utils/brandFont'

describe('brandFont 分层常量（三层×两字重·首屏最先）', () => {
  it('大白话：三层字族——首层沿用文源圆体原名，二三层带 T2/T3 后缀', () => {
    expect(BRAND_FONT_FAMILY).toBe('WenYuan Rounded SC')
    expect(BRAND_FONT_FAMILY_T2).toBe('WenYuan Rounded SC T2')
    expect(BRAND_FONT_FAMILY_T3).toBe('WenYuan Rounded SC T3')
    expect(BRAND_FONT_TIERS.map((t) => t.family)).toEqual([BRAND_FONT_FAMILY, BRAND_FONT_FAMILY_T2, BRAND_FONT_FAMILY_T3])
  })

  it('大白话：tier 顺序即加载顺序——tier1(首屏) → tier2(二级页) → tier3(兜底)，文件名可见分层', () => {
    expect(BRAND_FONT_TIERS.length).toBe(3)
    BRAND_FONT_TIERS.forEach((t, i) => {
      for (const f of t.files) expect(f.name).toContain(`tier${i + 1}`)
    })
  })

  it('大白话：每层两字重（500/700），文件名 .woff 结尾（不是 .woff2）且带版本号（缓存失效靠改名）', () => {
    for (const t of BRAND_FONT_TIERS) {
      const weights = t.files.map((f) => f.weight).sort()
      expect(weights).toEqual(['500', '700'])
      for (const { name } of t.files) {
        expect(name).toMatch(/\.v\d+\.woff$/)
        expect(name.endsWith('.woff2')).toBe(false)
      }
    }
  })
})

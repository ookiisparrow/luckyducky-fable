// 品牌字体分层接线黄金（批4 移植 + 字体分层批扩展）：源码扫描式（仿 pages-map.test.ts 大白话风格）——
// 防将来断线：三层×两字重形状对/族名对/加载顺序对（首屏最先）/app.ts 真调用/token 三族回退栈次序对/
// page 块真引用/持久缓存与重试真在。字符集覆盖归守卫 rw-mp-font-tier-subset-covers（check-structure），
// 产物文件名一致性也在该守卫侧由 brandFont.ts 与 assets/brand-fonts 同批产出保证。
// rewrite/mp/tsconfig.json 无 @types/node，不走 node:fs+import.meta.url，改走 `?raw` 原文导入（见 raw-imports.d.ts）。
import { describe, it, expect } from 'vitest'
import { BRAND_FONT_FAMILY, BRAND_FONT_FAMILY_T2, BRAND_FONT_FAMILY_T3, BRAND_FONT_TIERS } from '../utils/brandFont'
import brandFontSrc from '../utils/brandFont.ts?raw'
import appSrc from '../app.ts?raw'
import tokensSrc from '../styles/tokens.wxss?raw'
import appWxssSrc from '../app.wxss?raw'

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

  it('大白话：下载走 tcloudbaseapp 托管域名 /fonts/（DigiCert·域名在 downloadFile 白名单）', () => {
    expect(brandFontSrc).toMatch(/https:\/\/cloudbase-.*\.tcloudbaseapp\.com/)
    expect(brandFontSrc).toMatch(/\/fonts\/\$\{name\}/)
  })
})

describe('持久缓存 + 弱网重试（字体分层批新增·断线即真机回到「次次全量下载/瞬断整会话系统字」）', () => {
  it('大白话：缓存落 USER_DATA_PATH（官方保证跨冷启动持久·二次启动零网络）', () => {
    expect(brandFontSrc).toContain('USER_DATA_PATH')
    expect(brandFontSrc).toMatch(/copyFile/)
  })

  it('大白话：下载有显式 timeout 与退避重试（弱网瞬断不再单发即弃）', () => {
    expect(brandFontSrc).toMatch(/timeout:\s*DOWNLOAD_TIMEOUT_MS/)
    expect(brandFontSrc).toMatch(/RETRY_DELAYS_MS/)
  })
})

describe('app.ts 接线（loadBrandFonts 真被调用）', () => {
  it('大白话：app.ts 源码里出现 loadBrandFonts() 调用', () => {
    expect(appSrc).toMatch(/loadBrandFonts\(\)/)
  })
})

describe('tokens.wxss / app.wxss 接线（--ld-font-brand 三族回退栈 + page 块真引用）', () => {
  it('大白话：tokens.wxss 定义 --ld-font-brand，三层字族按 T1→T2→T3 次序打头（逐字回退补字的地基）', () => {
    const m = tokensSrc.match(/--ld-font-brand:\s*([^;]+);/)
    expect(m).toBeTruthy()
    const stack = m![1]
    const i1 = stack.indexOf(`'${BRAND_FONT_FAMILY}'`)
    const i2 = stack.indexOf(`'${BRAND_FONT_FAMILY_T2}'`)
    const i3 = stack.indexOf(`'${BRAND_FONT_FAMILY_T3}'`)
    expect(i1).toBe(stack.search(/\S/)) // T1 打头
    expect(i2).toBeGreaterThan(i1)
    expect(i3).toBeGreaterThan(i2) // 次序 T1 → T2 → T3（错序=首屏字被兜底族抢渲染）
  })

  it('大白话：app.wxss 的 page 块引用了 var(--ld-font-brand)', () => {
    const pageBlock = appWxssSrc.match(/page\s*\{[^}]*\}/)
    expect(pageBlock).toBeTruthy()
    expect(pageBlock![0]).toContain('var(--ld-font-brand)')
  })

  it('大白话：page 块显式钉了 font-weight，且值命中已注册字重（不留默认 400 空档）', () => {
    const pageBlock = appWxssSrc.match(/page\s*\{[^}]*\}/)
    expect(pageBlock).toBeTruthy()
    const m = pageBlock![0].match(/font-weight:\s*(\d+)/)
    expect(m).toBeTruthy()
    const registeredWeights = BRAND_FONT_TIERS[0].files.map((f) => f.weight)
    expect(registeredWeights).toContain(m![1])
  })
})

// 官网页脚备案号（Issue #102 ②·老板拍板：只挂号，不挂执照、不写公司法定名）。
// 读共用布局源码钉死——删号/改链/夹带执照或公司名必红。
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const layout = readFileSync(new URL('../src/layouts/Base.astro', import.meta.url), 'utf8')
const footer = layout.match(/<footer>[\s\S]*?<\/footer>/)?.[0] ?? ''

describe('官网共用页脚备案号', () => {
  it('大白话：页脚挂工信部备案号，点开能查，不写公司名也不挂执照；品牌行和小程序提示还在', () => {
    expect(footer).toContain('浙ICP备2024136798号-3')
    expect(footer).toContain('href="https://beian.miit.gov.cn/"')
    expect(footer).toContain('target="_blank"')
    expect(footer).toContain('rel="noopener noreferrer"')
    expect(footer).toContain('{BRAND_NAME} · 尝试钩织，创造幸运。')
    expect(footer).toContain('class="mp-hint"')
    expect(footer).toContain('微信搜「LuckyDucky小棉鸭」')
    expect(footer).not.toMatch(/执照/)
    expect(footer).not.toMatch(/有限公司|有限责任公司/)
  })
})

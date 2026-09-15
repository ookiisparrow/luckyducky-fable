// 官网页脚备案号 + 执照文字链（Issue #102 ②③）。
// 读共用布局源码钉死——删号/改链/页脚夹带执照图或公司法定名必红。
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const layout = readFileSync(new URL('../src/layouts/Base.astro', import.meta.url), 'utf8')
const footer = layout.match(/<footer>[\s\S]*?<\/footer>/)?.[0] ?? ''
const yyzzPage = readFileSync(new URL('../src/pages/yyzz.astro', import.meta.url), 'utf8')

describe('官网共用页脚备案号与执照链', () => {
  it('大白话：页脚挂工信部备案号，旁边一个「营业执照」文字链指向专页；品牌行和小程序提示还在；不写公司名、不把执照大图塞进页脚', () => {
    expect(footer).toContain('浙ICP备2024136798号-3')
    expect(footer).toContain('href="https://beian.miit.gov.cn/"')
    expect(footer).toContain('target="_blank"')
    expect(footer).toContain('rel="noopener noreferrer"')
    expect(footer).toContain('{BRAND_NAME} · 体验钩织，创造幸运。')
    expect(footer).toContain('class="mp-hint"')
    expect(footer).toContain('微信搜「LuckyDucky小棉鸭」')
    expect(footer).toContain('营业执照')
    expect(footer).toContain('href="/yyzz/"')
    expect(footer).not.toContain('yyzz.jpg')
    expect(footer).not.toMatch(/<img\b/)
    expect(footer).not.toMatch(/好好看|工作室|92330106|有限公司|有限责任公司/)
  })
})

describe('营业执照专页', () => {
  it('大白话：专页公开、标题就是营业执照、照片够大能看清；不另写法定名和信用代码段落；页可 noindex', () => {
    expect(yyzzPage).toContain('title="营业执照"')
    expect(yyzzPage).toContain('<h1>营业执照</h1>')
    expect(yyzzPage).toContain('src="/yyzz.jpg"')
    expect(yyzzPage).toContain('noindex')
    expect(yyzzPage).not.toMatch(/统一社会信用代码/)
    expect(yyzzPage).not.toMatch(/好好看文化/)
  })

  it('大白话：执照照片文件就在官网静态目录，是真 JPEG，专页才不会裂图', () => {
    const img = new URL('../public/yyzz.jpg', import.meta.url)
    expect(existsSync(img)).toBe(true)
    const bytes = readFileSync(img)
    expect(bytes.length).toBeGreaterThan(10_000)
    expect(bytes[0]).toBe(0xff)
    expect(bytes[1]).toBe(0xd8)
    expect(bytes[bytes.length - 2]).toBe(0xff)
    expect(bytes[bytes.length - 1]).toBe(0xd9)
  })
})

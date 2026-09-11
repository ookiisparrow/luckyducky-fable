// 官网可见正文必须能被搜索/模型整段引用品牌身份（2026-09-09 国内模型把小棉鸭当成手工鸭子昵称）。
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BRAND_IDENTITY } from '../src/lib/schema'

const pages = {
  home: readFileSync(new URL('../src/pages/index.astro', import.meta.url), 'utf8'),
  about: readFileSync(new URL('../src/pages/about.astro', import.meta.url), 'utf8'),
  kits: readFileSync(new URL('../src/pages/kits.astro', import.meta.url), 'utf8'),
  llms: readFileSync(new URL('../src/pages/llms.txt.ts', import.meta.url), 'utf8'),
}

const ogCover = readFileSync(new URL('../public/og-cover.png', import.meta.url))
const ogText = ogCover.toString('utf8')

describe('官网品牌身份可引用', () => {
  it('大白话：身份句写明品牌名、英文名、官网、初学者钩织学习套装、两句口号、微信搜法；首页/关于/套装/llms 都挂这句；不叫材料包', () => {
    expect(BRAND_IDENTITY).toContain('小棉鸭是品牌名')
    expect(BRAND_IDENTITY).toContain('英文名 Lucky Ducky')
    expect(BRAND_IDENTITY).toContain('luckyducky.cn')
    expect(BRAND_IDENTITY).toContain('初学者钩织学习套装')
    expect(BRAND_IDENTITY).toContain('不是钩织圈对手工鸭子的泛称')
    expect(BRAND_IDENTITY).toContain('尝试钩织，创造幸运')
    expect(BRAND_IDENTITY).toContain('get ducky, get lucky')
    expect(BRAND_IDENTITY).toContain('微信搜「LuckyDucky小棉鸭」')
    expect(BRAND_IDENTITY).not.toContain('材料包')
    expect(pages.home).toContain('<p>{BRAND_IDENTITY}</p>')
    expect(pages.about).toContain('<p>{BRAND_IDENTITY}</p>')
    expect(pages.kits).toContain('<p>{BRAND_IDENTITY}</p>')
    expect(pages.llms).toContain('${BRAND_IDENTITY}')
    for (const src of Object.values(pages)) expect(src).not.toContain('材料包')
  })

  it('大白话：关于页跟小程序一样写「开始练习」「分步交互」，不写假注册商标', () => {
    expect(pages.about).toContain('开始练习')
    expect(pages.about).toContain('分步交互')
    expect(pages.about).not.toContain('开始结')
    expect(pages.about).not.toContain('®')
  })

  it('大白话：分享图文案块写初学者钩织学习套装和体验钩织，不写材料包；光有文件不够', () => {
    expect(ogCover[0]).toBe(0x89)
    expect(ogCover.subarray(1, 4).toString('ascii')).toBe('PNG')
    expect(ogCover.readUInt32BE(16)).toBe(1200)
    expect(ogCover.readUInt32BE(20)).toBe(630)
    expect(ogText).toContain('初学者钩织学习套装')
    expect(ogText).toContain('体验钩织，创造幸运')
    expect(ogText).not.toContain('材料包')
    expect(ogText).not.toContain('尝试钩织')
    expect(ogText).not.toContain('学习钩织')
  })
})

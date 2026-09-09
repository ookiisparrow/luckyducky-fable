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
})

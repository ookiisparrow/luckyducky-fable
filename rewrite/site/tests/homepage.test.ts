// 官网首页 Hero + 主标题：大图先空着，标题用品牌名；luckyducky 小棉鸭。
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const home = readFileSync(new URL('../src/pages/index.astro', import.meta.url), 'utf8')
const about = readFileSync(new URL('../src/pages/about.astro', import.meta.url), 'utf8')
const kits = readFileSync(new URL('../src/pages/kits.astro', import.meta.url), 'utf8')
const hero = home.match(/<section class="hero"[\s\S]*?<\/section>/)?.[0] ?? ''

describe('官网首页 Hero 与主标题', () => {
  it('大白话：首页顶部有一块空着的主视觉位，还不塞图；标题写 luckyducky 小棉鸭；关于/套装页不出现这块', () => {
    expect(home).toContain('<h1>luckyducky 小棉鸭</h1>')
    expect(home).not.toContain('一针一线，钩出一只小暖鸭')
    expect(hero).toContain('class="hero"')
    expect(hero).toContain('class="hero-visual"')
    expect(hero).not.toMatch(/<img\b/)
    expect(hero).not.toMatch(/\bsrc=/)
    expect(about).not.toContain('class="hero"')
    expect(kits).not.toContain('class="hero"')
  })
})

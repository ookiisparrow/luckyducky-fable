// 2026-09-13 夜间研究点名的官网诚实剩渣（#258 未覆盖）：头注计数 / 搜索名 / M4 墓碑 / 教程双源 / 死导出。
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8')
const rss = src('../src/pages/rss.xml.ts')
const home = src('../src/pages/index.astro')
const tutorialsIndex = src('../src/pages/tutorials/index.astro')
const llms = src('../src/pages/llms.txt.ts')
const schema = src('../src/lib/schema.ts')
const tutorialsLib = src('../src/lib/tutorials.ts')
const astroCfg = src('../astro.config.mjs')
const pkg = JSON.parse(src('../package.json')) as { description: string }
const q = src('../public/q/index.html')

describe('官网诚实剩渣', () => {
  it('大白话：RSS 头注不写死页数、也不谎称 schema 测试锁了 RSS 转义', () => {
    expect(rss).not.toContain('10 页')
    expect(rss).not.toContain('schema.test 同仓')
  })

  it('大白话：激活页手动步骤跟全站一样写微信搜「LuckyDucky小棉鸭」，不写过期的「小棉鸭」搜法', () => {
    expect(q).toContain('微信搜「LuckyDucky小棉鸭」')
    expect(q).not.toContain('搜索小程序「小棉鸭」')
  })

  it('大白话：site 包说明和构建配置不再挂已完成的 M4 里程碑墓碑', () => {
    expect(pkg.description).not.toMatch(/\bM4\b/)
    expect(astroCfg).not.toMatch(/\bM4\b/)
  })

  it('大白话：教程合集页和 RSS 频道说明同一句话，排序只写一处', () => {
    expect(tutorialsLib).toContain('export const TUTORIALS_DESCRIPTION')
    expect(tutorialsLib).toContain('export async function sortedTutorials')
    expect(tutorialsIndex).toContain('description={TUTORIALS_DESCRIPTION}')
    expect(rss).toContain('${esc(TUTORIALS_DESCRIPTION)}')
    for (const page of [home, tutorialsIndex, rss, llms]) {
      expect(page).toContain('sortedTutorials()')
      expect(page).not.toContain("getCollection('tutorials')).sort")
    }
  })

  it('大白话：ArticleInput / HowToStep 只给本文件函数用，不对外出口', () => {
    expect(schema).toContain('interface ArticleInput')
    expect(schema).toContain('interface HowToStep')
    expect(schema).not.toContain('export interface ArticleInput')
    expect(schema).not.toContain('export interface HowToStep')
  })
})

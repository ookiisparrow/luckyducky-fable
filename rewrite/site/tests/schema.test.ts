// JSON-LD 构造（守卫 rw-site-schema-golden·GEO 核心）：缺必填回 null 不产半空卡/
// 脏步骤剔除/日期格式闸/相对路径转绝对/面包屑单级无意义。
import { describe, it, expect } from 'vitest'
import { articleSchema, howToSchema, faqSchema, breadcrumbSchema, orgSchema, SITE } from '../src/lib/schema'

describe('Article 卡', () => {
  it('大白话：字段齐全出卡（相对路径转绝对·未给修改日回落发布日）；缺标题/坏日期回 null 不产半空卡', () => {
    const a = articleSchema({ title: '起针教程', description: '五分钟学会', path: '/tutorials/qizhen/', datePublished: '2026-07-04' })!
    expect(a['@type']).toBe('Article')
    expect(a.url).toBe(SITE + '/tutorials/qizhen/')
    expect(a.dateModified).toBe('2026-07-04') // 回落发布日
    expect(articleSchema({ title: '', description: 'x', path: '/p', datePublished: '2026-07-04' })).toBeNull()
    expect(articleSchema({ title: 't', description: 'x', path: '/p', datePublished: '07/04/2026' })).toBeNull() // 坏日期
  })
})

describe('HowTo / FAQ 卡', () => {
  it('大白话：步骤带序号；脏步骤剔除；全空回 null（半空卡比没有更伤收录）', () => {
    const h = howToSchema('起针', '描述', [
      { name: '绕环', text: '绕两圈' },
      { name: '', text: '脏行' },
      null,
      { name: '收紧', text: '拉线尾' },
    ])!
    const steps = h.step as Array<Record<string, unknown>>
    expect(steps).toHaveLength(2)
    expect(steps[0]).toMatchObject({ position: 1, name: '绕环' })
    expect(steps[1].position).toBe(2)
    expect(howToSchema('起针', '', [])).toBeNull()
    expect(howToSchema('', '', [{ name: 'a', text: 'b' }])).toBeNull()
    const f = faqSchema([{ q: '有洞怎么办', a: '拉紧线尾' }, { q: '', a: 'x' }])!
    expect((f.mainEntity as unknown[]).length).toBe(1)
    expect(faqSchema([])).toBeNull()
  })
})

describe('面包屑与组织卡', () => {
  it('大白话：面包屑带层级序号与绝对地址；单级/脏项不出卡；组织卡带品牌名', () => {
    const b = breadcrumbSchema([
      { name: '首页', path: '/' },
      { name: '教程', path: '/tutorials/' },
    ])!
    const items = b.itemListElement as Array<Record<string, unknown>>
    expect(items[1]).toMatchObject({ position: 2, item: SITE + '/tutorials/' })
    expect(breadcrumbSchema([{ name: '首页', path: '/' }])).toBeNull() // 单级无意义
    expect(orgSchema().name).toContain('小棉鸭')
  })
})

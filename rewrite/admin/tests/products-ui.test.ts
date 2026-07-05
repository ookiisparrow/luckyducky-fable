// 商品与橱窗映射（守卫 rw-admin-products-ui-golden）：三态口径与云端一致/四道门人话原文兜底/
// 整档 round-trip 保真/图片尺寸闸提前拦/脏档安全。
import { describe, it, expect } from 'vitest'
import { productState, mapDraftRows, publishErrorText, mapShowcaseRows, b64SizeOk } from '../src/lib/mapProducts'

describe('三态口径（与云端 listDrafts listed 表一致）', () => {
  it('大白话：表里 true=在售、false=已下架、不在表=筹备中（未上架）', () => {
    const m = { p1: true, p2: false }
    expect(productState('p1', m)).toBe('onsale')
    expect(productState('p2', m)).toBe('unlisted')
    expect(productState('p3', m)).toBe('preparing')
    expect(productState('p1', null)).toBe('preparing') // 表缺失安全
  })

  it('大白话：行映射带整档 raw（编辑 round-trip——保存不丢参数表/详情段落等未绑字段）；脏档剔除', () => {
    const draft = { id: 'p1', name: '小熊', price: 22, cover: 'cloud://c.jpg', skus: [{ name: 'a', price: 22 }], params: [['尺寸', '18cm']], detailSections: [{ lead: 'x', body: 'y' }] }
    const rows = mapDraftRows([draft, { name: '无 id' }, null], { 'cloud://c.jpg': 'https://tmp/c.jpg' }, { p1: true })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ stateLabel: '在售', coverUrl: 'https://tmp/c.jpg', skuCount: 1 })
    expect(rows[0].raw).toEqual(draft) // 整档在·高级字段不丢
  })
})

describe('上架四道门人话（原文兜底不吞）', () => {
  it('大白话：四类拒因各有人话；未知错误保留原文（不糊成一句失败）', () => {
    expect(publishErrorText('NEED_COVER')).toContain('封面')
    expect(publishErrorText('NEED_INFO')).toContain('价格')
    expect(publishErrorText('NEED_SKUS')).toContain('规格')
    expect(publishErrorText('NO_DRAFT')).toContain('草稿')
    expect(publishErrorText('WEIRD_500')).toContain('WEIRD_500') // 原文兜底
  })
})

describe('橱窗映射与图片闸', () => {
  it('大白话：按 sort 升序、带在售标记；脏档剔除；图片 80K 提前拦（云端 90K 前的缓冲）', () => {
    const rows = mapShowcaseRows(
      [
        { id: 'b', name: 'B', sort: 2, featured: true, listed: false, price: '39', tag: '热销', cover: 'f1' },
        { id: 'a', name: 'A', sort: 1 },
        { noid: true },
      ],
      { f1: 'https://x/f1.jpg' }
    )
    expect(rows.map((r) => r.id)).toEqual(['a', 'b']) // sort 升序
    expect(rows[1]).toMatchObject({ featured: true, listed: false, price: '39', tag: '热销' }) // 手机预览字段（换皮丢·B 组还原）
    expect(rows[1].coverUrl).toBe('https://x/f1.jpg')
    expect(rows[0].price).toBe('') // 缺价不谎报
    expect(b64SizeOk('x'.repeat(80_000))).toBe(true)
    expect(b64SizeOk('x'.repeat(80_001))).toBe(false)
    expect(b64SizeOk('')).toBe(false)
  })
})

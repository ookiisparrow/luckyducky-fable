// 商品与橱窗映射（守卫 rw-admin-products-ui-golden）：三态口径与云端一致/四道门人话原文兜底/
// 整档 round-trip 保真/图片尺寸闸提前拦/脏档安全。
import { describe, it, expect } from 'vitest'
import { productState, mapDraftRows, publishErrorText, mapShowcaseRows, b64SizeOk, productSteps, basicsMissing, wizardCanPublish } from '../src/lib/mapProducts'

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

  it('大白话：多规格价显最低价 +「起」（换皮平铺 product.price 丢了起价语义）；单规格无「起」；无 SKU 退商品价', () => {
    expect(mapDraftRows([{ id: 'm', name: 'x', price: 30, skus: [{ name: 'a', price: 22 }, { name: 'b', price: 35 }] }], {}, {})[0].priceLabel).toBe('¥22 起')
    expect(mapDraftRows([{ id: 's', name: 'x', price: 30, skus: [{ name: 'a', price: 22 }] }], {}, {})[0].priceLabel).toBe('¥22') // 单规格无起
    expect(mapDraftRows([{ id: 'n', name: 'x', price: 30, skus: [] }], {}, {})[0].priceLabel).toBe('¥30') // 无 SKU 退商品价
    expect(mapDraftRows([{ id: 'u', name: 'x', skus: [] }], {}, {})[0].priceLabel).toBe('未定价')
  })

  it('大白话：6 步上新进度（换皮误判「无源·略」·实则 cards/courses/qrcodes 后端 join 派生）：图片/信息/SKU 前端算·视频/卡片/批次取后端 extras', () => {
    const steps = productSteps(
      { id: 'p1', name: '熊', price: 20, cover: 'c', skus: [{ name: 'a' }], courseId: 'course-p1' },
      { hasVideo: { 'course-p1': true }, cardFinal: { p1: true }, hasBatch: {} }
    )
    expect(steps.map((s) => s.done)).toEqual([true, true, true, true, true, false]) // 图片/信息/SKU/视频/卡片 done·批次未
    expect(steps.map((s) => s.key)).toEqual(['image', 'info', 'sku', 'video', 'card', 'batch'])
    // 缺项全灭；courseId 缺省回退 course-<id>
    const empty = productSteps({ id: 'p2', name: '', price: '', cover: '', skus: [] }, {})
    expect(empty.every((s) => !s.done)).toBe(true)
    const derived = productSteps({ id: 'p3', name: 'x', price: 1, cover: 'c', skus: [{}] }, { hasBatch: { 'course-p3': true } })
    expect(derived.find((s) => s.key === 'batch')!.done).toBe(true) // courseId 缺→course-p3 回退命中
    // mapDraftRows 带 extras 时行含 steps + doneCount
    const rows = mapDraftRows([{ id: 'p1', name: '熊', price: 20, cover: 'c', skus: [{ name: 'a' }], courseId: 'course-p1' }], {}, { p1: true }, { hasVideo: { 'course-p1': true }, cardFinal: { p1: true }, hasBatch: { 'course-p1': true } })
    expect(rows[0].doneCount).toBe(6)
    expect(rows[0].steps).toHaveLength(6)
  })
})

describe('上新向导上架闸（basicsMissing/wizardCanPublish·前三步必备·换皮把事前预检退成事后报错）', () => {
  it('大白话：封面/名称/价格/有效规格四项缺哪报哪；四项齐才可上架（步4-6 视频/卡片/批次非上架硬门槛）', () => {
    // 空档：四项全缺、不可上架
    expect(basicsMissing({})).toEqual(['封面图', '商品名称', '价格', '至少一个有效规格'])
    expect(wizardCanPublish({})).toBe(false)
    // 四项齐：无缺、可上架
    const ok = { cover: 'c', name: '熊', price: 20, skus: [{ name: '标准', price: 20 }] }
    expect(basicsMissing(ok)).toEqual([])
    expect(wizardCanPublish(ok)).toBe(true)
    // 规格行不完整（有名无价）算缺——与云端 NEED_SKUS 同口径（每行须名+有效价）
    expect(basicsMissing({ cover: 'c', name: '熊', price: 20, skus: [{ name: '标准', price: '' }] })).toEqual(['至少一个有效规格'])
    // 名称仅空白算缺（trim）
    expect(basicsMissing({ cover: 'c', name: '  ', price: 20, skus: [{ name: 'a', price: 1 }] })).toEqual(['商品名称'])
    // 价格空串算缺
    expect(basicsMissing({ cover: 'c', name: '熊', price: '', skus: [{ name: 'a', price: 1 }] })).toEqual(['价格'])
    // 脏档安全（null 不崩·当作全缺）
    expect(wizardCanPublish(null as any)).toBe(false)
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

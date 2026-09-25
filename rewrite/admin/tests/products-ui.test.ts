// 商品与橱窗映射：三态口径与云端一致/四道门人话原文兜底/
// 整档 round-trip 保真/图片尺寸闸提前拦/脏档安全。
import { describe, it, expect } from 'vitest'
import { productState, mapDraftRows, publishErrorText, mapShowcaseRows, b64SizeOk, productSteps, stepProgressHint, stepDotTitle, courseNeedsPublish, productsListSub, basicsMissing, wizardCanPublish, freshDraft, DRAFT_PRICE_HINT, draftSyncLabel, draftSyncConfirm, restoreSaleLabel, restoreSaleConfirm, restoreSaleOk, draftSyncUnlistedOk, draftSyncBusy, draftSyncOk, COURSE_VS_LISTING_HINT, HOME_FEATURE_ASK, HOME_FEATURE_SWITCH_ON, HOME_FEATURE_SWITCH_OFF, VIDEO_MARK_FILE, VIDEO_MARK_LIVE } from '../src/lib/mapProducts'

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

  it('大白话：5 步上新进度：建档+封面 / 图与名 / 详情前端算·视频 / 卡片+批次取后端 extras', () => {
    const steps = productSteps(
      { id: 'p1', name: '熊', price: 20, cover: 'c', skus: [{ name: 'a', price: 20 }], courseId: 'course-p1' },
      { hasVideo: { 'course-p1': true }, cardFinal: { p1: true }, hasBatch: {} }
    )
    expect(steps.map((s) => s.done)).toEqual([true, true, true, true, false]) // 前四步齐·第 5 步要卡片+批次都齐
    expect(steps.map((s) => s.key)).toEqual(['create', 'look', 'detail', 'video', 'cardQr'])
    expect(steps.every((s) => !s.label.includes('设计'))).toBe(true)
    // 有编号但没封面＝第 1 步未完成；有封面没名字＝第 1 步完成、第 2 步未
    const empty = productSteps({ id: 'p2', name: '', price: '', cover: '', skus: [] }, {})
    expect(empty.find((s) => s.key === 'create')!.done).toBe(false)
    expect(empty.every((s) => !s.done)).toBe(true)
    const covered = productSteps({ id: 'p2', name: '', cover: 'c', skus: [] }, {})
    expect(covered.find((s) => s.key === 'create')!.done).toBe(true)
    expect(covered.find((s) => s.key === 'look')!.done).toBe(false)
    expect(productSteps({ id: 'p4', name: 'x', price: 1, cover: 'c', skus: [{ name: 'a' }] }).find((s) => s.key === 'detail')!.done).toBe(false)
    expect(productSteps({ id: 'p4', name: 'x', price: 1, cover: 'c', skus: [{ name: 'a', price: '' }] }).find((s) => s.key === 'detail')!.done).toBe(false)
    const derived = productSteps({ id: 'p3', name: 'x', price: 1, cover: 'c', skus: [{}] }, { cardFinal: { p3: true }, hasBatch: { 'course-p3': true } })
    expect(derived.find((s) => s.key === 'cardQr')!.done).toBe(true) // courseId 缺→course-p3 回退命中
    expect(productSteps({ id: 'p3', cover: 'c' }, { hasBatch: { 'course-p3': true } }).find((s) => s.key === 'cardQr')!.done).toBe(false)
    const rows = mapDraftRows([{ id: 'p1', name: '熊', price: 20, cover: 'c', skus: [{ name: 'a', price: 20 }], courseId: 'course-p1' }], {}, { p1: true }, { hasVideo: { 'course-p1': true }, coursePublished: { 'course-p1': true }, cardFinal: { p1: true }, hasBatch: { 'course-p1': true } })
    expect(rows[0].doneCount).toBe(5)
    expect(rows[0].steps).toHaveLength(5)
    expect(stepProgressHint(rows[0].steps)).toBe('上新完成')
    expect(stepProgressHint(empty)).toBe('第 1 步：新建与封面')
    expect(stepProgressHint(covered)).toBe('第 2 步：图片与名字')
  })

  it('大白话：第 4 步圆点能分开「有视频文件」和「课已发布」；有文件就算本步齐，发布课不挡先卖材料包', () => {
    const fileOnly = productSteps(
      { id: 'p1', name: '熊', price: 20, cover: 'c', skus: [{ name: 'a', price: 20 }], courseId: 'course-p1' },
      { hasVideo: { 'course-p1': true }, coursePublished: {}, cardFinal: { p1: true }, hasBatch: { 'course-p1': true } },
    )
    const video = fileOnly.find((s) => s.key === 'video')!
    expect(video.done).toBe(true)
    expect(video.marks).toEqual([
      { key: 'file', label: VIDEO_MARK_FILE, done: true },
      { key: 'live', label: VIDEO_MARK_LIVE, done: false },
    ])
    expect(courseNeedsPublish(fileOnly)).toBe(true)
    expect(stepProgressHint(fileOnly)).toBe('上新完成 · 课未发布')
    expect(stepDotTitle(video)).toContain('✓有视频文件')
    expect(stepDotTitle(video)).toContain('○课已发布')
    expect(wizardCanPublish({ cover: 'c', name: '熊', price: 20, skus: [{ name: '标', price: 20 }] })).toBe(true)
    expect(COURSE_VS_LISTING_HINT).toContain('商品上架 ≠ 课程发布')
    expect(COURSE_VS_LISTING_HINT).toContain('先卖材料包')
    const live = productSteps(
      { id: 'p1', name: '熊', price: 20, cover: 'c', skus: [{ name: 'a', price: 20 }], courseId: 'course-p1' },
      { hasVideo: { 'course-p1': true }, coursePublished: { 'course-p1': true } },
    )
    expect(courseNeedsPublish(live)).toBe(false)
    expect(live.find((s) => s.key === 'video')!.marks!.every((m) => m.done)).toBe(true)
  })

  it('大白话：同步/恢复用三套字——在售说新价新图，已下架同步仍停售，恢复不假装拷了草稿', () => {
    expect(draftSyncLabel('preparing')).toBe('上架')
    expect(draftSyncLabel('onsale')).toBe('同步到小程序')
    expect(draftSyncLabel('unlisted')).toBe('同步草稿')
    expect(draftSyncConfirm('preparing')).toBe('确认上架？')
    expect(draftSyncConfirm('onsale')).toBe('顾客将看到新价/新图')
    expect(draftSyncConfirm('onsale')).not.toMatch(/上架|重新上架|确认上架/)
    expect(draftSyncConfirm('unlisted')).toContain('仍停售')
    expect(draftSyncConfirm('unlisted')).toContain('新价/新图')
    expect(restoreSaleLabel()).toBe('恢复销售')
    expect(restoreSaleConfirm()).toContain('上次上架页')
    expect(restoreSaleConfirm()).toContain('不是刚才改的草稿')
    expect(restoreSaleConfirm()).toContain('若刚改过价/图请先同步草稿')
    expect(restoreSaleOk()).toContain('若刚改过价/图请先同步草稿')
    expect(draftSyncUnlistedOk()).toContain('仍停售')
    expect(DRAFT_PRICE_HINT).toBe('先存草稿，同步后顾客才见')
    expect(draftSyncBusy('preparing')).toBe('上架中…')
    expect(draftSyncBusy('onsale')).toBe('同步中…')
    expect(draftSyncOk('preparing')).toContain('已上架')
    expect(draftSyncOk('preparing')).toContain('首页人气条未打开')
    expect(draftSyncOk('preparing')).toContain('出现在首页')
    expect(draftSyncOk('preparing', { featured: true })).toContain('首页人气条')
    expect(draftSyncOk('preparing', { featured: true })).toContain('出现在首页')
    expect(draftSyncOk('onsale')).toContain('已同步到小程序')
    expect(draftSyncOk('unlisted')).toBe(draftSyncUnlistedOk())
    expect(HOME_FEATURE_ASK).toBe('要不要同时出现在首页')
    expect(HOME_FEATURE_SWITCH_ON).toBe('出现在首页')
    expect(HOME_FEATURE_SWITCH_OFF).toBe('不出现在首页')
    expect(publishErrorText('NEED_COVER', 'preparing')).toContain('上架')
    expect(publishErrorText('NEED_COVER', 'preparing')).not.toContain('同步到小程序')
    expect(publishErrorText('NEED_COVER', 'unlisted')).toContain('同步草稿')
    expect(publishErrorText('WEIRD_500', 'unlisted')).toContain('同步草稿')
  })

  it('大白话：副标有筹备中才跟「待完成上新」；0 款筹备中不写待完成', () => {
    expect(productsListSub(3, 2)).toBe('共 3 款商品 · 2 款筹备中待完成上新')
    expect(productsListSub(4, 0)).toBe('共 4 款商品')
    expect(productsListSub(0, 0)).toBe('共 0 款商品')
  })
})

describe('上新向导上架闸（basicsMissing/wizardCanPublish·前三步必备·换皮把事前预检退成事后报错）', () => {
    it('大白话：封面/名称/价格/有效规格四项缺哪报哪；四项齐才可上架（步 4–5 视频/卡片与二维码非上架硬门槛）', () => {
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
    expect(publishErrorText('WEIRD_500')).toContain('同步到小程序')
    expect(publishErrorText('NEED_COVER', 'onsale')).toContain('同步到小程序')
  })
})

describe('新建草稿骨架（freshDraft·向导第 1 步与列表「去上新」同形）', () => {
  it('大白话：新建草稿自带课程号，切片由 Products.vue showCover/showLook/showDetail 管', () => {
    const d = freshDraft('p9')
    expect(d.id).toBe('p9')
    expect(d.courseId).toBe('course-p9')
    expect(d.name).toBe('')
    expect(d.sold).toBe(0)
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

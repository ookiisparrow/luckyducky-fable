// 黄金 learning-content §九「首页内容公开读·无记录前端回退默认文案·空块仍用默认防误清空」
// + 展示面 fail-closed（防「¥undefined」类真机事故·根因#8 展示层半边）。
import { describe, it, expect } from 'vitest'
import { BRAND_NAME, BRAND_SLOGAN_CN, HOME_SHARE_TITLE, LEARNER_KIT } from '../lib/brand'
import { mapHero, mapProducts, mapHomeContent, pickDuckKit } from '../lib/mapHome'

describe('首页 hero 映射（黄金 §九：缺档回退默认文案·不空屏不半空）', () => {
  it('大白话：没配置首页内容 → 完整默认文案；配了一半 → 缺的那半回退默认、配的那半用配置', () => {
    const empty = mapHero(null)
    expect(empty.title).toBeTruthy()
    expect(empty.tagline).toBeTruthy()
    const half = mapHero({ hero: { title: '春季上新啦' } })
    expect(half.title).toBe('春季上新啦')
    expect(half.tagline).toBe(empty.tagline) // 缺 tagline 回退默认·不半空
    expect(mapHero({ hero: { title: '', tagline: '' } }).title).toBe(empty.title) // 空串也算缺
  })
  it('缺 hero 图 → 回退包内品牌兜底鸭图（不留灰·README 图片矩阵「hero 品牌门面·不留灰」·区别商品 cover 落灰占位）', () => {
    expect(mapHero(null).img).toBe('/static/hero-full.jpg') // 缺档→本地兜底鸭图
    expect(mapHero({ hero: {} }).img).toBe('/static/hero-full.jpg') // 空 hero 块→兜底
    expect(mapHero({ hero: { img: '' } }).img).toBe('/static/hero-full.jpg') // 空串也算缺→兜底
    expect(mapHero({ hero: { img: 'cloud://x/hero.png' } }).img).toBe('cloud://x/hero.png') // 后台配了→用后台图（覆盖兜底）
  })
})

describe('商品网格映射（展示面 fail-closed：脏行不上首页）', () => {
  it('大白话：正常商品原样标价（元·不做算术）；无名/无价/价格非法的脏行整行剔除，绝不渲染「¥undefined」', () => {
    const vm = mapProducts([
      { id: 'p1', name: '小棉鸭礼盒', tag: '送礼首选', price: 198, was: 258, cover: 'cloud://x/cover.png' },
      { _id: 'p2', name: '单只装', price: 98 }, // 老档 _id 兼容·无 was 无 cover
      { id: 'p3', name: '', price: 100 }, // 无名剔除
      { id: 'p4', name: '坏价格', price: 'abc' }, // 价非法剔除
      { id: 'p5', name: '零价', price: 0 }, // 0 元不上架面
      null, // 脏元素不崩
    ])
    expect(vm.map((p) => p.id)).toEqual(['p1', 'p2'])
    expect(vm[0]).toEqual({ id: 'p1', name: '小棉鸭礼盒', tag: '送礼首选', priceLabel: '¥198.00', wasLabel: '¥258.00', cover: 'cloud://x/cover.png' })
    expect(vm[1].priceLabel).toBe('¥98.00') // 老板拍板 1：金额一律两位小数
    expect(vm[1].wasLabel).toBe('') // 无划线价→空串·模板按空隐藏
    expect(JSON.stringify(vm)).not.toContain('undefined')
    expect(mapProducts(undefined)).toEqual([]) // 非数组入参安全
  })
})

// ── 首页全板块内容映射（重设计 9 板块·黄金 §九：整档回退 + 逐字段/逐块回退·空块仍用默认） ──
describe('首页全板块映射 mapHomeContent（缺档/空块逐块回退设计默认·不空屏）', () => {
  it('大白话：整档缺失 → 每个板块都拿到完整的设计默认文案（标题/引导/条目齐全、条目数对）', () => {
    const d = mapHomeContent(null)
    // 每块都有默认文案，不空屏
    expect(d.hero.title).toBeTruthy()
    expect(d.hero.tagline).toBeTruthy()
    expect(d.hero.search).toBeTruthy()
    expect(d.brand.name).toBeTruthy()
    expect(d.brand.lead).toBeTruthy()
    expect(d.feature.title).toBeTruthy()
    expect(d.feature.body).toBeTruthy()
    expect(d.trust.length).toBe(3) // 包邮/退货/推荐
    expect(d.reassure.heading).toBeTruthy()
    expect(d.reassure.items.length).toBe(3) // 放心开始/难以失败/幸运随行
    expect(d.reviews.heading).toBeTruthy()
    expect(d.reviews.items).toEqual([]) // 拍板 B：没有后台真评论就没有买家秀（不写死示例）
    expect(d.faq.length).toBe(4)
    expect(d.closing.title).toBeTruthy()
    expect(d.closing.cta).toBeTruthy()
    expect(d.footer.links.length).toBeGreaterThan(0)
    expect(d.footer.copy).toBeTruthy()
    // 每条 trust/reassure 项都带图标名 + 文案（图标名只用来挑像素动画）
    expect(d.trust.every((t) => t.icon && t.label)).toBe(true)
    expect(d.reassure.items.every((r) => r.icon && r.title && r.body)).toBe(true)
    expect(JSON.stringify(d)).not.toContain('undefined')
  })

  it('大白话：信任条每项配一个像素动画——后台图标名认得就对应（卡车/盾牌/爱心），认不得按位置轮流', () => {
    expect(mapHomeContent(null).trust.map((t) => t.anim)).toEqual(['truck', 'shield', 'heart'])
    const got = mapHomeContent({
      trust: [
        { icon: 'thumbs-up', label: '推荐' },
        { icon: 'rocket', label: '极速' },
        { icon: 'shield-check', label: '保障' },
        { label: '无图标' },
      ],
    }).trust.map((t) => t.anim)
    expect(got).toEqual(['heart', 'shield', 'shield', 'truck'])
  })

  it('大白话：配了某板块的一部分 → 配的用配置、没配的字段/条目回退默认（不半空）', () => {
    const def = mapHomeContent(null)
    const d = mapHomeContent({
      hero: { title: '春季上新', img: 'cloud://x/hero.png' }, // 只配 title+img
      reassure: { heading: '我们替你扫清障碍' }, // 只配大标题，lead/items 缺
    })
    expect(d.hero.title).toBe('春季上新')
    expect(d.hero.img).toBe('cloud://x/hero.png')
    expect(d.hero.tagline).toBe(def.hero.tagline) // 缺→默认
    expect(d.reassure.heading).toBe('我们替你扫清障碍')
    expect(d.reassure.lead).toBe(def.reassure.lead) // 缺→默认
    expect(d.reassure.items).toEqual(def.reassure.items) // 缺→默认整组
  })

  it('大白话：配了非空数组 → 用配置的那组（覆盖默认）；配了空数组 → 仍回退默认（防误清空线上·黄金 §九）', () => {
    const def = mapHomeContent(null)
    const over = mapHomeContent({ faq: [{ title: '发货多久？', body: '48 小时内' }] })
    expect(over.faq).toEqual([{ title: '发货多久？', body: '48 小时内' }]) // 覆盖默认 4 条
    expect(mapHomeContent({ trust: [] }).trust).toEqual(def.trust) // 空数组→默认
    expect(mapHomeContent({ faq: [] }).faq).toEqual(def.faq)
    expect(mapHomeContent({ footer: { links: [] } }).footer.links).toEqual(def.footer.links)
  })

  it('大白话：配置里的脏条目（缺必填字段）整条剔除；整组全脏 → 回退默认（fail-closed·不渲染半条卡）', () => {
    const def = mapHomeContent(null)
    // trust 缺 label、review 缺 quote、faq 缺 title、footer link 缺 label → 全脏
    expect(mapHomeContent({ trust: [{ icon: 'truck' }] }).trust).toEqual(def.trust)
    expect(mapHomeContent({ reviews: { items: [{ user: '小明' }] } }).reviews.items).toEqual([])
    expect(mapHomeContent({ faq: [{ body: '只有答案没问题' }] }).faq).toEqual(def.faq)
    // 部分脏：干净的留下、脏的剔除
    const mixed = mapHomeContent({ faq: [{ title: 'Q1', body: 'A1' }, { body: '无题剔除' }] })
    expect(mixed.faq).toEqual([{ title: 'Q1', body: 'A1' }])
    expect(JSON.stringify(mapHomeContent({ reviews: { items: [{ user: '小明' }] } }))).not.toContain('undefined')
  })

  it('大白话：入参不是对象也不崩（脏档安全·同商品网格的 fail-closed）', () => {
    expect(() => mapHomeContent(undefined)).not.toThrow()
    expect(() => mapHomeContent('乱七八糟')).not.toThrow()
    expect(() => mapHomeContent(42)).not.toThrow()
    expect(mapHomeContent([]).hero.title).toBeTruthy() // 数组入参也回退默认
  })

  it('大白话：footer.links 是纯字符串数组（admin 存法）→ 原样透传，不塌成 [object Object]', () => {
    const d = mapHomeContent({ footer: { links: ['关于我们', '联系方式'] } })
    expect(d.footer.links).toEqual(['关于我们', '联系方式'])
    expect(JSON.stringify(d)).not.toContain('[object Object]')
  })

  it('大白话：footer.links 混脏（空串/null/对象）→ 只留干净的字符串项', () => {
    const d = mapHomeContent({ footer: { links: ['好链', '', null, {}] } })
    expect(d.footer.links).toEqual(['好链'])
  })

  it('大白话：footer.links 全脏 → 回退默认链接组', () => {
    const def = mapHomeContent(null)
    const d = mapHomeContent({ footer: { links: ['', null, {}] } })
    expect(d.footer.links).toEqual(def.footer.links)
  })

  it('大白话：默认信任条/拆门槛/页脚/FAQ 跟赵老板体验定稿，首页看不见七天无理由', () => {
    const d = mapHomeContent(null)
    expect(d.trust.map((t) => t.label)).toEqual(['包邮到家', '售后无忧', '多数买家推荐'])
    expect(d.trust.some((t) => t.label.includes('七天无理由'))).toBe(false)
    expect(d.reassure.items[0].body).toBe('每份' + LEARNER_KIT + '包含初次尝试所需的一切，另含「开始练习」以及「分步交互」视频教程，助你轻松无忧创作。')
    expect(d.faq[1].title).toBe('材料包里都有什么？')
    expect(d.faq[2].body).toBe('可以。线材用尽或钩错都能在社群申请补料，售后无忧。')
    expect(d.faq[2].body).not.toContain('七天')
    expect(d.footer.links).toEqual(['关于我们', BRAND_NAME]) // 设计稿页脚「Lucky Ducky 小棉鸭」中间带空格＝店名单源
    expect(JSON.stringify(d)).not.toContain('七天无理由')
  })

  it('大白话：CMS 还写着旧信任条/旧页脚/旧 FAQ 退货句，顾客看见的是新口径', () => {
    const d = mapHomeContent({
      trust: [{ icon: 'rotate-ccw', label: '七天无理由退货' }],
      footer: { links: ['Lucky 鸭'] },
      faq: [{ title: '做坏了可以补料吗？', body: '可以。线材用尽或钩错都能在社群申请补料，七天内不满意还可无理由退货。' }],
    })
    expect(d.trust[0].label).toBe('售后无忧')
    expect(d.footer.links).toEqual([BRAND_NAME])
    expect(mapHomeContent({ footer: { links: ['Lucky Ducky小棉鸭'] } }).footer.links).toEqual([BRAND_NAME]) // 旧稿没空格也补上
    expect(d.faq[0].body).toBe('可以。线材用尽或钩错都能在社群申请补料，售后无忧。')
  })
})

describe('买家秀（拍板 B）', () => {
  it('大白话：没配真评论/拉取失败——一条示例评论都不给（整块不显示）；配了真评论就用它', () => {
    expect(JSON.stringify(mapHomeContent(null))).not.toMatch(/小满|阿橙|柚子/)
    expect(mapHomeContent({ reviews: { items: [] } }).reviews.items).toEqual([])
    expect(mapHomeContent({ reviews: { items: [{ quote: '好看', user: '阿木' }] } }).reviews.items).toEqual([{ quote: '好看', user: '阿木', img: '' }])
  })
})

describe('首页购买跳小棉鸭详情 pickDuckKit', () => {
  it('大白话：货架上第一件名字带小棉鸭的就用它；还没上小棉鸭就先拿第一件商品占位（拍板 18）；货架空才给 null', () => {
    const duck = { id: 'kit-2', name: '小棉鸭入门套装', tag: '', priceLabel: '¥128', wasLabel: '', cover: '' }
    const other = { id: 'yarn', name: '补充棉线', tag: '', priceLabel: '¥29', wasLabel: '', cover: '' }
    expect(pickDuckKit([other, duck])).toEqual(duck)
    expect(pickDuckKit([other])).toEqual(other)
    expect(pickDuckKit([])).toBeNull()
  })
})

describe('口号与分享标题正册', () => {
  it('大白话：中文口号是体验钩织；首页分享标题带初学者套装和口号', () => {
    expect(BRAND_SLOGAN_CN).toBe('体验钩织，创造幸运。')
    expect(HOME_SHARE_TITLE).toBe('小棉鸭初学者钩织学习套装｜体验钩织，创造幸运')
  })
})

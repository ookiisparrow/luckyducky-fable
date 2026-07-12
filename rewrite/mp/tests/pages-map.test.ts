// 五页 CMS 内容映射黄金（守卫 rw-mp-page-content-golden·同 mapHome 黄金 §九）：整档 null / 逐块缺 /
// 逐字段空 都回退设计默认——CMS 拉不到或字段被误清空时页面永不空白（fail-soft）。逐 mapper 钉默认回退行为。
import { describe, it, expect } from 'vitest'
import { mapWelcome, mapCatalogPlayer, mapMe, mapAbout, mapAgreement } from '../lib/mapPages'

describe('mapWelcome（W1 恭喜屏 + W2 三件事·缺档回退默认·不空屏）', () => {
  it('大白话：整档 null → W1 三字段 + W2 三点位全默认，且每点位带图标', () => {
    const d = mapWelcome(null)
    expect(d.w1.title).toBeTruthy()
    expect(d.w1.sub).toBeTruthy()
    expect(d.w1.warning).toBeTruthy()
    expect(d.w2.items.length).toBe(3)
    expect(d.w2.items.every((p) => p.icon && p.title && p.desc)).toBe(true)
  })

  it('大白话：配了一半 → 配的用配置、缺的回退默认（逐字段·不半空）', () => {
    const def = mapWelcome(null)
    const d = mapWelcome({ w1: { title: '欢迎开课' }, w2: { items: [{ title: '第一点自定义' }] } })
    expect(d.w1.title).toBe('欢迎开课')
    expect(d.w1.sub).toBe(def.w1.sub) // 缺→默认
    expect(d.w2.items[0].title).toBe('第一点自定义')
    expect(d.w2.items[0].desc).toBe(def.w2.items[0].desc) // 缺 desc→默认
    expect(d.w2.items[0].icon).toBe(def.w2.items[0].icon) // 图标 tied to position·恒默认
    expect(d.w2.items[1]).toEqual(def.w2.items[1]) // 第二点位 CMS 未给→整槽默认
  })

  it('大白话：warning 被清空（空串）→ 强制回默认（不可退货告知不允许被清空）', () => {
    const def = mapWelcome(null)
    expect(mapWelcome({ w1: { warning: '' } }).w1.warning).toBe(def.w1.warning)
    expect(mapWelcome({ w1: { warning: '   ' } }).w1.warning).toBe(def.w1.warning) // 纯空白也算清空
  })

  it('大白话：脏档不崩（非对象入参安全）', () => {
    expect(() => mapWelcome('乱')).not.toThrow()
    expect(() => mapWelcome(42)).not.toThrow()
    expect(mapWelcome([]).w2.items.length).toBe(3)
  })
})

describe('mapCatalogPlayer（目录页 hero/CTA/空态 + 播放页求助三卡/FAQ·缺档回退默认）', () => {
  it('大白话：整档 null → CTA/空态默认、三卡标题默认、FAQ 空数组、heroImage undefined（页面走 bgFor）', () => {
    const d = mapCatalogPlayer(null)
    expect(d.catalog.resumeCta).toBeTruthy()
    expect(d.catalog.emptyLesson).toBeTruthy()
    expect(d.catalog.heroImage).toBeUndefined() // 空 → undefined（让页面走 bgFor 回退链）
    expect(d.help.contactTitle).toBeTruthy()
    expect(d.help.videosTitle).toBeTruthy()
    expect(d.help.faqTitle).toBeTruthy()
    expect(d.help.faq).toEqual([]) // 默认无 FAQ → 播放页维持诚实空态导流客服
  })

  it('大白话：heroImage 空串 → undefined；给了非空 → 原样透传', () => {
    expect(mapCatalogPlayer({ catalog: { heroImage: '' } }).catalog.heroImage).toBeUndefined()
    expect(mapCatalogPlayer({ catalog: { heroImage: '   ' } }).catalog.heroImage).toBeUndefined()
    expect(mapCatalogPlayer({ catalog: { heroImage: 'https://x/hero.png' } }).catalog.heroImage).toBe('https://x/hero.png')
  })

  it('大白话：逐字段回退——只配 resumeCta，其余缺的回默认', () => {
    const def = mapCatalogPlayer(null)
    const d = mapCatalogPlayer({ catalog: { resumeCta: '继续钩' }, help: { contactTitle: '找客服' } })
    expect(d.catalog.resumeCta).toBe('继续钩')
    expect(d.catalog.emptyLesson).toBe(def.catalog.emptyLesson) // 缺→默认
    expect(d.help.contactTitle).toBe('找客服')
    expect(d.help.videosTitle).toBe(def.help.videosTitle) // 缺→默认
  })

  it('大白话：FAQ 有内容 → 渲染；空数组 / 全脏（无 q）→ 回退空数组（不造假·维持空态）', () => {
    const d = mapCatalogPlayer({ help: { faq: [{ q: '要多久？', a: '3-4 小时' }, { a: '无问题剔除' }] } })
    expect(d.help.faq).toEqual([{ q: '要多久？', a: '3-4 小时' }]) // 脏条剔除
    expect(mapCatalogPlayer({ help: { faq: [] } }).help.faq).toEqual([])
    expect(mapCatalogPlayer({ help: { faq: [{ a: '只有答案' }] } }).help.faq).toEqual([]) // 全脏→空（非造假默认）
  })
})

describe('mapMe（默认昵称 + 九入口标题/可见性·未知 key 忽略·visible:false 隐藏）', () => {
  it('大白话：整档 null → 默认昵称 + 九入口全默认标题、全可见', () => {
    const d = mapMe(null)
    expect(d.defaultNickname).toBeTruthy()
    const keys = ['courses', 'orders', 'aftersales', 'address', 'activate', 'feedback', 'kefu', 'consent', 'about'] as const
    for (const k of keys) {
      expect(d.entries[k].label).toBeTruthy()
      expect(d.entries[k].visible).toBe(true)
    }
  })

  it('大白话：改名某入口 → 用新名；visible:false → 隐藏；未知 key → 忽略（不新增条目）', () => {
    const def = mapMe(null)
    const d = mapMe({
      defaultNickname: '手作达人',
      entries: [
        { key: 'address', label: '我的地址' }, // 改名
        { key: 'consent', visible: false }, // 隐藏
        { key: 'nonsense', label: '乱来' }, // 未知 key 忽略
      ],
    })
    expect(d.defaultNickname).toBe('手作达人')
    expect(d.entries.address.label).toBe('我的地址')
    expect(d.entries.consent.visible).toBe(false)
    expect(d.entries.about.label).toBe(def.entries.about.label) // 未提及的入口维持默认
    expect((d.entries as Record<string, unknown>).nonsense).toBeUndefined() // 未知 key 不进 entries
  })

  it('大白话：entries 缺失/非数组 → 全默认全可见；label 空 → 回退默认标题', () => {
    expect(mapMe({ defaultNickname: '' }).entries.kefu.visible).toBe(true) // entries 缺 → 默认
    const def = mapMe(null)
    expect(mapMe({ entries: [{ key: 'feedback', label: '' }] }).entries.feedback.label).toBe(def.entries.feedback.label)
    expect(mapMe({ defaultNickname: '' }).defaultNickname).toBe(def.defaultNickname) // 空昵称→默认
  })
})

describe('mapAbout（lead + 三段自述·缺档回退默认全文）', () => {
  it('大白话：整档 null → lead + 三段默认全文', () => {
    const d = mapAbout(null)
    expect(d.lead).toBeTruthy()
    expect(d.sections.length).toBe(3)
    expect(d.sections.every((s) => s.title && s.body)).toBe(true)
  })

  it('大白话：配了 sections → 用配置；空数组 / 全脏 → 回退默认全文（防误清空）', () => {
    const def = mapAbout(null)
    const d = mapAbout({ lead: '自定义引导', sections: [{ title: '新段', body: '正文' }] })
    expect(d.lead).toBe('自定义引导')
    expect(d.sections).toEqual([{ title: '新段', body: '正文' }])
    expect(mapAbout({ sections: [] }).sections).toEqual(def.sections) // 空数组→默认
    expect(mapAbout({ sections: [{ body: '无题剔除' }] }).sections).toEqual(def.sections) // 全脏→默认
    expect(mapAbout({ lead: '' }).lead).toBe(def.lead) // 空 lead→默认
  })
})

describe('mapAgreement（用户协议/隐私政策·缺档回退默认全文·intro 固定合规文本）', () => {
  it('大白话：整档 null → user/privacy 两文档默认全文（含引言 + ≥8 条条款）', () => {
    const d = mapAgreement(null)
    for (const doc of [d.user, d.privacy]) {
      expect(doc.title).toBeTruthy()
      expect(doc.updated).toBeTruthy()
      expect(doc.intro).toBeTruthy()
      expect(doc.articles.length).toBeGreaterThanOrEqual(8) // 条款条目齐（同旧线 agreement-text-real 精神）
      expect(doc.articles.every((a) => a.title && a.body)).toBe(true)
    }
    // 隐私政策第三方披露事实对齐（快递100·不通过微信授权）不因回退丢失
    expect(d.privacy.intro).toContain('不通过微信授权')
    expect(JSON.stringify(d.privacy.articles)).toContain('快递100')
  })

  it('大白话：CMS 给了 effectiveDate + sections → 覆盖更新日期与条款；intro/title 恒固定（合规文本不被覆盖）', () => {
    const def = mapAgreement(null)
    const d = mapAgreement({
      user: { effectiveDate: '2026-08', sections: [{ title: '第一条 新', body: '新正文' }] },
    })
    expect(d.user.updated).toBe('2026-08')
    expect(d.user.articles).toEqual([{ title: '第一条 新', body: '新正文' }])
    expect(d.user.intro).toBe(def.user.intro) // 引言固定·不被 CMS 覆盖
    expect(d.user.title).toBe(def.user.title) // 标题固定
  })

  it('大白话：sections 空数组 / 全脏 → 回退默认全文（防误清空过审文本）', () => {
    const def = mapAgreement(null)
    expect(mapAgreement({ user: { sections: [] } }).user.articles).toEqual(def.user.articles)
    expect(mapAgreement({ privacy: { sections: [{ body: '无题' }] } }).privacy.articles).toEqual(def.privacy.articles)
    expect(mapAgreement({ user: { effectiveDate: '' } }).user.updated).toBe(def.user.updated) // 空日期→默认
  })
})

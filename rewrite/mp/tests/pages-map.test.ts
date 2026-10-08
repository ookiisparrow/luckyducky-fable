// 五页 CMS 内容映射黄金（四页在 lib/mapPages、「我」页在 lib/mapMe；同 mapHome 黄金 §九）：整档 null / 逐块缺 /
// 逐字段空 都回退设计默认——CMS 拉不到或字段被误清空时页面永不空白（fail-soft）。逐 mapper 钉默认回退行为。
import { describe, it, expect } from 'vitest'
import { mapWelcome, mapCatalogPlayer, mapAbout, mapAgreement } from '../lib/mapPages'
import { mapMe } from '../lib/mapMe'

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

  it('大白话：默认进课警示只换产品名，确认进课仍不可退货，不再写材料包', () => {
    const w = mapWelcome(null).w1.warning
    expect(w).toBe('确认进课后，这份初学者钩织学习套装将不可退货')
    expect(w).not.toContain('材料包')
  })

  it('大白话：脏档不崩（非对象入参安全）', () => {
    expect(() => mapWelcome('乱')).not.toThrow()
    expect(() => mapWelcome(42)).not.toThrow()
    expect(mapWelcome([]).w2.items.length).toBe(3)
  })
})

describe('W2「求助」说明对得上播放页真实位置（UI 审查 2026-09-29）', () => {
  it('大白话：播放页中间是播放键、求助在底栏最右——默认文案指右下角，不再说「中间那颗」「永远在」', () => {
    const help = mapWelcome(null).w2.items.find((p) => p.icon === 'life-buoy')
    expect(help?.desc).toContain('右下角')
    expect(help?.desc).not.toMatch(/中间|永远在/)
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
    // 关于页默认稿只换产品名，故事不重写
    const who = d.sections.find((s) => s.title === '我们是谁')
    const what = d.sections.find((s) => s.title === '我们做什么')
    expect(who?.body).toContain('专注钩织的初学者钩织学习套装品牌')
    expect(who?.body).toContain('打包成一个个初学者钩织学习套装')
    expect(what?.body).toContain('每一份初学者钩织学习套装都配有分步教学视频')
    expect(d.sections.map((s) => s.body).join('\n')).not.toContain('材料包')
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

describe('协议「重要条款」显著提示（UI 审查 2026-09-29·民法典§496 格式条款提示义务）', () => {
  it('大白话：正文写着「重要条款」的那条（第四条·进课后失去七天无理由）打上重点标记，其余不打；后台覆盖的条款同样按原文认', () => {
    const user = mapAgreement(null).user.articles
    expect(user.filter((a) => a.important).map((a) => a.title.slice(0, 3))).toEqual(['第四条'])
    const cms = mapAgreement({ user: { sections: [{ title: '甲', body: '普通' }, { title: '乙', body: '此为重要条款，请注意' }] } }).user.articles
    expect(cms.map((a) => a.important)).toEqual([false, true])
  })
})

describe('隐私政策第六条与「退出登录 / 删除个人资料」对齐（老板 2026-09-30 定稿·§39）', () => {
  it('大白话：删除个人资料在政策末尾、课程与学习进度保留、可随时退出登录不删资料；不再说删了就回不到课程', () => {
    const p = mapAgreement(null).privacy
    const six = p.articles.find((a) => a.title.startsWith('第六条'))?.body ?? ''
    expect(six).toContain('可在本政策末尾使用“删除个人资料”')
    expect(six).toContain('你已购买并激活的课程与学习进度作为交易与服务记录保留')
    expect(six).toContain('退出不删除任何资料')
    expect(JSON.stringify(p.articles)).not.toContain('不能再回到原来的个人资料与课程')
    expect(p.updated).toBe('2026-09')
  })
})

describe('隐私政策第三条：受托客服数据共享登录即默认开启、可撤回（老板 2026-09-30 定稿·§40）', () => {
  it('大白话：写明登录即默认开启、在「我 → 数据共享授权」撤回；不再说「以你的同意为前提」', () => {
    const three = mapAgreement(null).privacy.articles.find((a) => a.title.startsWith('第三条'))?.body ?? ''
    expect(three).toContain('你登录即默认开启此项数据共享授权，可随时在小程序「我 → 数据共享授权」中撤回（撤回后不影响此前已依约进行的处理）。')
    expect(three).not.toContain('以你的同意为前提')
  })
})

describe('mapAgreement（用户协议/隐私政策·缺档回退默认全文·intro 固定合规文本）', () => {
  it('大白话：整档 null → user/privacy 两文档默认全文（含引言 + ≥8 条条款）', () => {
    const d = mapAgreement(null)
    for (const doc of [d.user, d.privacy]) {
      expect(doc.title).toBeTruthy()
      expect(doc.updated).toBeTruthy()
      expect(doc.intro).toBeTruthy()
      expect(doc.articles.length).toBeGreaterThanOrEqual(8) // 条款条目齐
      expect(doc.articles.every((a) => a.title && a.body)).toBe(true)
    }
    // 隐私政策第三方披露事实对齐（快递100·不通过微信授权）不因回退丢失
    expect(d.privacy.intro).toContain('不通过微信授权')
    expect(JSON.stringify(d.privacy.articles)).toContain('快递100')
    // 客服会话含 PII，归档留存必须在隐私政策里声明
    expect(JSON.stringify(d.privacy.articles)).toContain('客服会话记录')
    // 用户协议默认稿：产品名「初学者钩织学习套装」；扫印刷码只开欢迎页、仍可退；确认进课才失七天无理由
    const userBodies = d.user.articles.map((a) => a.body).join('\n')
    const article4 = d.user.articles.find((a) => a.title.startsWith('第四条'))?.body ?? ''
    const article5 = d.user.articles.find((a) => a.title.startsWith('第五条'))?.body ?? ''
    expect(userBodies).toContain('本小程序提供初学者钩织学习套装等实物商品的在线销售')
    expect(userBodies).toContain('初学者钩织学习套装内含用于开通配套课程的唯一二维码')
    expect(article4).toContain('扫描该印刷二维码仅打开欢迎页')
    expect(article4).toContain('并不因扫码而失去七天无理由退货的权利')
    expect(article4).toContain('仅当你在欢迎页确认进课后')
    expect(article4).toContain('失去七天无理由退货的权利')
    expect(article4).toContain('你下单及在欢迎页确认进课即表示已知悉并同意')
    expect(article4).not.toContain('下单及扫码')
    expect(article4).not.toContain('扫码并确认开始观看')
    expect(article5).toContain('尚未确认进课')
    expect(article5).toContain('除新疆、内蒙古、西藏外包邮')
    expect(article5).toContain('确认进课后该件不可退')
    expect(article5).toContain('如需发票，请联系客服。')
    expect(article5).not.toContain('确认开始观看课程')
    expect(article5).not.toMatch(/满\s*¥?\s*100\s*包邮/)
    expect(article5).not.toContain('全场包邮')
    expect(userBodies).not.toContain('材料包')
    // 隐私默认稿：头像昵称只在编辑资料自愿填；补上微信指引已声明的相册/剪切板/摄像头
    const privacyBodies = d.privacy.articles.map((a) => a.body).join('\n')
    expect(privacyBodies).toContain('编辑资料')
    expect(privacyBodies).toContain('删除资料')
    expect(privacyBodies).toContain('订单等交易记录依法留存')
    expect(privacyBodies).toContain('杭州市西湖区好好看文化艺术工作室')
    expect(privacyBodies).toContain('自愿')
    expect(privacyBodies).toMatch(/相册|选中的照片或视频/)
    expect(privacyBodies).toContain('剪切板')
    expect(privacyBodies).toMatch(/摄像头/)
    expect(privacyBodies).toContain('注视屏幕')
    expect(privacyBodies).toContain('暂停手工教学视频')
    expect(d.user.articles[1].body).toContain('登录不索取你的手机号')
  })

  it('大白话：CMS 给了 effectiveDate + sections → 覆盖更新日期与条款；intro/title 恒固定（合规文本不被覆盖）', () => {
    const def = mapAgreement(null)
    const d = mapAgreement({
      user: { effectiveDate: '2026-08', sections: [{ title: '第一条 新', body: '新正文' }] },
    })
    expect(d.user.updated).toBe('2026-08')
    expect(d.user.articles).toEqual([{ title: '第一条 新', body: '新正文', important: false }])
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

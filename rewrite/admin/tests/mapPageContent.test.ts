// 页面内容 CMS 五页签映射往返（批C）：normalize 缺块补形 + 超限截断；payload 裁剪限长 + 不夹带未知字段；
// agreement history 只读、不进 payload。限长与云端白名单（adminApi/content.ts）同源——测试钉死两处一致。
import { describe, it, expect } from 'vitest'
import {
  normalizeWelcome,
  welcomePayload,
  normalizeCatalogPlayer,
  catalogPlayerPayload,
  normalizeMePage,
  mePagePayload,
  normalizeAbout,
  aboutPayload,
  normalizeAgreement,
  agreementPayload,
  ME_ENTRIES,
  combineSaveMessages,
  SAVE_OK_MESSAGE,
} from '../src/lib/mapPageContent'
import usePageContentSrc from '../src/lib/usePageContent.ts?raw'
import homeContentFormSrc from '../src/components/pagecontent/HomeContentForm.vue?raw'

describe('welcome 欢迎与激活往返', () => {
  it('大白话：缺档全默认空串；w2 至多 3 条、超限截断；payload 与 normalize 同形不夹带未知字段', () => {
    expect(normalizeWelcome(null)).toEqual({ w1: { title: '', sub: '', warning: '' }, w2: { items: [] } })
    const m = normalizeWelcome({
      w1: { title: 'x'.repeat(80), sub: '副', warning: '保留原意' },
      w2: { items: [{ title: 'a', desc: 'd1' }, { title: 'b', desc: 'd2' }, { title: 'c', desc: 'd3' }, { title: 'd', desc: '第4条超额' }] },
    })
    expect(m.w1.title).toHaveLength(60) // 超限截断到 60
    expect(m.w2.items).toHaveLength(3) // 第 4 条被砍
    const p = welcomePayload(m) as any
    expect(Object.keys(p).sort()).toEqual(['w1', 'w2']) // 不夹带未知字段
    expect(Object.keys(p.w1).sort()).toEqual(['sub', 'title', 'warning'])
    expect(p.w2.items[0]).toEqual({ title: 'a', desc: 'd1' })
    // payload 也封顶 3（即便表单被塞第 4 条）
    m.w2.items.push({ title: 'e', desc: '溢出' })
    expect((welcomePayload(m) as any).w2.items).toHaveLength(3)
  })
})

describe('catalogPlayer 目录与播放往返', () => {
  it('大白话：hero/续播/空态 + 求助三卡标题 + FAQ 至多 20；缺块补形；payload 不夹带未知字段', () => {
    expect(normalizeCatalogPlayer(null)).toEqual({
      catalog: { heroImage: '', resumeCta: '', emptyLesson: '' },
      help: { contactTitle: '', videosTitle: '', faqTitle: '', faq: [] },
    })
    const raw = { catalog: { heroImage: 'cloud://h.jpg', resumeCta: '继续学习' }, help: { faqTitle: '常见问题', faq: Array.from({ length: 25 }, (_, i) => ({ q: 'q' + i, a: 'a' + i })) } }
    const m = normalizeCatalogPlayer(raw)
    expect(m.catalog.heroImage).toBe('cloud://h.jpg')
    expect(m.catalog.emptyLesson).toBe('') // 缺块补空
    expect(m.help.faq).toHaveLength(20) // FAQ 封顶 20
    const p = catalogPlayerPayload(m) as any
    expect(Object.keys(p).sort()).toEqual(['catalog', 'help'])
    expect(Object.keys(p.help.faq[0]).sort()).toEqual(['a', 'q'])
    expect(p.help.faq).toHaveLength(20)
    // payload 封顶独立于 normalize（表单里被塞超 20 条时 payload 也必须裁到 20·反向自检咬点）
    m.help.faq.push(...Array.from({ length: 5 }, (_, i) => ({ q: 'extra' + i, a: 'x' })))
    expect(m.help.faq).toHaveLength(25) // 模型侧确已超额
    expect((catalogPlayerPayload(m) as any).help.faq).toHaveLength(20) // payload 仍封顶 20
  })
})

describe('mePage 我的与关于往返', () => {
  it('大白话：固定 9 键顺序展示；存档 label/visible 覆盖默认；集外脏 key 不出现；payload 只发 9 键', () => {
    const m = normalizeMePage(null)
    expect(m.entries.map((e) => e.key)).toEqual(ME_ENTRIES.map((e) => e.key)) // 固定顺序
    expect(m.entries.every((e) => e.visible)).toBe(true) // 缺档默认全可见
    const saved = normalizeMePage({
      defaultNickname: '小鸭用户',
      entries: [
        { key: 'orders', label: '订单们', visible: false },
        { key: 'BOGUS', label: '脏键', visible: true }, // 集外
      ],
    })
    expect(saved.defaultNickname).toBe('小鸭用户')
    const orders = saved.entries.find((e) => e.key === 'orders')!
    expect(orders).toEqual({ key: 'orders', label: '订单们', visible: false }) // 存档覆盖
    expect(saved.entries.find((e) => e.key === 'BOGUS')).toBeUndefined() // 集外键不出现
    const p = mePagePayload(saved) as any
    expect(p.entries).toHaveLength(9) // 只发 9 键
    expect(p.entries.map((e: any) => e.key)).toEqual(ME_ENTRIES.map((e) => e.key))
    expect(p.entries.find((e: any) => e.key === 'orders')).toEqual({ key: 'orders', label: '订单们', visible: false })
    expect(Object.keys(p).sort()).toEqual(['defaultNickname', 'entries'])
  })
})

describe('about 关于我们往返', () => {
  it('大白话：lead + 段落至多 10；超限截断；payload 不夹带未知字段', () => {
    expect(normalizeAbout(null)).toEqual({ lead: '', sections: [] })
    const m = normalizeAbout({ lead: 'l'.repeat(250), sections: Array.from({ length: 13 }, (_, i) => ({ title: 't' + i, body: 'b' + i })) })
    expect(m.lead).toHaveLength(200) // 超限截断
    expect(m.sections).toHaveLength(10) // 段落封顶 10
    const p = aboutPayload(m) as any
    expect(Object.keys(p).sort()).toEqual(['lead', 'sections'])
    expect(Object.keys(p.sections[0]).sort()).toEqual(['body', 'title'])
    expect(p.sections).toHaveLength(10)
  })
})

describe('MeAboutTab 两档保存结果聚合（P1 修复·批N：me/about 各自独立 save() 不能互相遮蔽失败信号）', () => {
  it('大白话：me 保存成功、about 保存失败——用户必须能看到失败信号，不能只看到成功提示（原 || 短路会把这条吃掉）', () => {
    const r = combineSaveMessages(SAVE_OK_MESSAGE, '保存失败：STOCK_CONFLICT')
    expect(r.error).toBe(true)
    expect(r.message).not.toBe(SAVE_OK_MESSAGE) // 不能被 me 的成功文案整个遮蔽
    expect(r.message).toContain('关于我们') // 点名是哪一档失败
    expect(r.message).toContain('保存失败：STOCK_CONFLICT') // 具体原因原样带出
    expect(r.message).not.toContain('「我」页') // 成功的一档不误报失败
  })

  it('大白话：about 成功、me 失败——同理必须暴露 me 的失败，不因 about 先/后完成而丢信息', () => {
    const r = combineSaveMessages('内容未成功载入，暂不能保存（避免覆盖已有配置·请刷新重试）', SAVE_OK_MESSAGE)
    expect(r.error).toBe(true)
    expect(r.message).toContain('「我」页')
    expect(r.message).toContain('内容未成功载入')
    expect(r.message).not.toContain('关于我们')
  })

  it('大白话：两档都失败——两条失败话术都要在、不能只留一条', () => {
    const r = combineSaveMessages('保存失败：网络错误', '保存失败：服务器错误')
    expect(r.error).toBe(true)
    expect(r.message).toContain('「我」页：保存失败：网络错误')
    expect(r.message).toContain('「关于我们」：保存失败：服务器错误')
  })

  it('大白话：两档都成功才显示统一成功提示；两边都还没存过（空 message）也不误报失败', () => {
    expect(combineSaveMessages(SAVE_OK_MESSAGE, SAVE_OK_MESSAGE)).toEqual({ error: false, message: SAVE_OK_MESSAGE })
    expect(combineSaveMessages('', '')).toEqual({ error: false, message: SAVE_OK_MESSAGE })
  })
})

describe('agreement 协议文案往返', () => {
  it('大白话：user/privacy 各至多 30 段；history 只读展示、不进 payload；payload 只发 user+privacy', () => {
    expect(normalizeAgreement(null)).toEqual({
      user: { version: '', effectiveDate: '', sections: [] },
      privacy: { version: '', effectiveDate: '', sections: [] },
      history: [],
    })
    const m = normalizeAgreement({
      user: { version: 'v2.0', effectiveDate: '2026-07-12', sections: Array.from({ length: 33 }, (_, i) => ({ title: 't' + i, body: 'b' + i })) },
      privacy: { version: 'v1.3', effectiveDate: '2026-06-01', sections: [{ title: '数据', body: '说明' }] },
      history: [{ part: 'user', version: 'v1.0', at: '2026-05-01T00:00:00.000Z' }],
    })
    expect(m.user.sections).toHaveLength(30) // 段落封顶 30
    expect(m.history).toHaveLength(1) // 只读保留展示
    const p = agreementPayload(m) as any
    expect(Object.keys(p).sort()).toEqual(['privacy', 'user']) // history 不进 payload
    expect(p.history).toBeUndefined()
    expect(p.user.version).toBe('v2.0')
    expect(p.user.sections).toHaveLength(30)
    expect(p.privacy.sections).toEqual([{ title: '数据', body: '说明' }])
  })
})

// SAVE_OK_MESSAGE 手抄单源化（债目·E4 顺手改批）：曾经 usePageContent.ts save() 与 HomeContentForm.vue
// save() 各自手抄一份「已保存，小程序立即生效」字面量、自称与 mapPageContent.ts「同源」——三处三份改一漏二即
// 漂移。现两处改 import mapPageContent.ts 的 SAVE_OK_MESSAGE 复用，全仓该文案字面量只剩一处定义点。
describe('SAVE_OK_MESSAGE 单源化（防手抄回潮）', () => {
  it('大白话：usePageContent.ts / HomeContentForm.vue 都不再手抄字面量，改 import SAVE_OK_MESSAGE 复用', () => {
    expect(usePageContentSrc).not.toContain('已保存，小程序立即生效')
    expect(usePageContentSrc).toMatch(/import\s*\{\s*SAVE_OK_MESSAGE\s*\}\s*from\s*'\.\/mapPageContent'/)
    expect(usePageContentSrc).toMatch(/message\.value = r\.ok \? SAVE_OK_MESSAGE :/)

    expect(homeContentFormSrc).not.toContain('已保存，小程序立即生效')
    expect(homeContentFormSrc).toMatch(/import\s*\{\s*SAVE_OK_MESSAGE\s*\}\s*from\s*'\.\.\/\.\.\/lib\/mapPageContent'/)
    expect(homeContentFormSrc).toMatch(/message\.value = r\.ok \? SAVE_OK_MESSAGE :/)
  })
})

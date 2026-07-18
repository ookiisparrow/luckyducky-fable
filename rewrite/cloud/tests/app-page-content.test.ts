// 页面内容 CMS 云读写链（批A·守卫 rw-cloud-page-content-sanitized·信任边界 fail-closed·根因#3 不信前端）：
// adminApi savePageContent/getPageContent 每页白名单净化（超长截断/数组封顶/未知字段丢弃/未知 page 拒）
// + agreement history 服务端追加与 cap；app 公开读 getPageContent 同白名单 + catalogPlayer.heroImage 换址。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import cloud, { control } from 'wx-server-sdk'
import { savePageContent, getPageContent } from '../src/functions/adminApi/actions/content'
import { main as app } from '../src/functions/app/index'
import { __resetTempUrlCacheForTest } from '../src/kit/storage'

const db = () => (cloud as unknown as { database: () => any }).database()
const save = (page: string, data: unknown) => savePageContent({ db: db(), data: { page, data } } as any)
const getAdmin = (page: string) => getPageContent({ db: db(), data: { page } } as any)
const bodyOf = (r: any) => JSON.parse(r.body)
const appCall = (action: string, data: Record<string, unknown> = {}): Promise<any> => app({ action, data })

beforeEach(() => {
  control.reset()
  __resetTempUrlCacheForTest() // 批1·清签发缓存·隔离跨 case 复用相同 heroImage fileID 的污染（getPageContent 走 maxAge）
  control.setOpenId('')
})
afterEach(() => vi.restoreAllMocks())

describe('welcome（欢迎流·超长截断 + w2 封顶 + 未知字段丢弃）', () => {
  it('大白话：w1 title/sub/warning 超长截断、w2 items 封顶 3、未知字段一律丢弃', async () => {
    await save('welcome', {
      w1: { title: 'a'.repeat(80), sub: 'b'.repeat(200), warning: 'c'.repeat(200), evil: 'x' },
      w2: {
        items: [
          { title: 't1', desc: 'd1', junk: 1 },
          { title: 't2', desc: 'd2' },
          { title: 't3', desc: 'd3' },
          { title: 't4', desc: 'd4' },
        ],
      },
      hacker: 'drop-me',
    })
    const c = bodyOf(await getAdmin('welcome')).content
    expect(c.w1.title.length).toBe(60)
    expect(c.w1.sub.length).toBe(120)
    expect(c.w1.warning.length).toBe(120)
    expect(c.w1.evil).toBeUndefined() // 未知字段丢弃
    expect(c.hacker).toBeUndefined() // 顶层未知字段丢弃
    expect(c.w2.items.length).toBe(3) // 封顶 3
    expect(c.w2.items[0].junk).toBeUndefined()
  })
})

describe('catalogPlayer（目录+播放页求助·FAQ 封顶 + 截断）', () => {
  it('大白话：faq 封顶 20、q≤120/a≤1000 截断、heroImage(fileID)≤200、resumeCta/emptyLesson≤40', async () => {
    const faq = Array.from({ length: 25 }, (_, i) => ({ q: 'q'.repeat(200), a: 'a'.repeat(1200), n: i }))
    await save('catalogPlayer', {
      catalog: { heroImage: 'cloud://' + 'h'.repeat(300), resumeCta: 'r'.repeat(60), emptyLesson: 'e'.repeat(60) },
      help: { contactTitle: 'ct', videosTitle: 'vt', faqTitle: 'ft', faq },
    })
    const c = bodyOf(await getAdmin('catalogPlayer')).content
    expect(c.help.faq.length).toBe(20)
    expect(c.help.faq[0].q.length).toBe(120)
    expect(c.help.faq[0].a.length).toBe(1000)
    expect(c.help.faq[0].n).toBeUndefined() // 未知字段丢弃
    expect(c.catalog.heroImage.length).toBe(200)
    expect(c.catalog.resumeCta.length).toBe(40)
    expect(c.catalog.emptyLesson.length).toBe(40)
  })
})

describe('mePage（我的·集外 key 丢弃 + entries 封顶 + visible 语义）', () => {
  it('大白话：集外 key 丢弃、defaultNickname≤20、visible 默认 true/显式 false', async () => {
    await save('mePage', {
      defaultNickname: 'n'.repeat(30),
      entries: [
        { key: 'courses', label: '教程' },
        { key: 'HACKER', label: '恶意集外键' }, // 集外 → 丢弃
        { key: 'orders', label: '订单', visible: false },
      ],
    })
    const c = bodyOf(await getAdmin('mePage')).content
    expect(c.defaultNickname.length).toBe(20)
    expect(c.entries.map((e: any) => e.key)).toEqual(['courses', 'orders']) // HACKER 被丢弃
    expect(c.entries.find((e: any) => e.key === 'courses').visible).toBe(true) // 默认可见
    expect(c.entries.find((e: any) => e.key === 'orders').visible).toBe(false) // 显式隐藏
  })

  it('大白话：entries 封顶 12（全合法键也截）', async () => {
    await save('mePage', { entries: Array.from({ length: 14 }, () => ({ key: 'about', label: '关于' })) })
    const c = bodyOf(await getAdmin('mePage')).content
    expect(c.entries.length).toBe(12)
  })
})

describe('about（关于我们·段落封顶 + 截断）', () => {
  it('大白话：lead≤200、sections 封顶 10、title≤60/body≤2000 截断', async () => {
    await save('about', {
      lead: 'L'.repeat(300),
      sections: Array.from({ length: 15 }, () => ({ title: 't'.repeat(80), body: 'b'.repeat(3000), junk: 1 })),
    })
    const c = bodyOf(await getAdmin('about')).content
    expect(c.lead.length).toBe(200)
    expect(c.sections.length).toBe(10)
    expect(c.sections[0].title.length).toBe(60)
    expect(c.sections[0].body.length).toBe(2000)
    expect(c.sections[0].junk).toBeUndefined()
  })
})

describe('agreement（协议·history 服务端追加与 cap·客户端伪造忽略）', () => {
  it('大白话：首存追 user+privacy 两条、客户端传的 history 忽略、同版本再存不追、改版本只追变更部分', async () => {
    await save('agreement', {
      user: { version: '1.0', effectiveDate: '2026-01-01', sections: [{ title: 't', body: 'b' }] },
      privacy: { version: '1.0', effectiveDate: '2026-01-01', sections: [] },
      history: [{ part: 'FAKE', version: '999', at: 'forged' }], // 客户端伪造 → 忽略
    })
    let c = bodyOf(await getAdmin('agreement')).content
    expect(c.history.length).toBe(2)
    expect(c.history.every((h: any) => h.part !== 'FAKE')).toBe(true) // 伪造被忽略
    expect(c.history.map((h: any) => h.part).sort()).toEqual(['privacy', 'user'])
    expect(typeof c.history[0].at).toBe('string') // 服务端 ISO 时间戳
    expect(c.user.sections[0].body).toBe('b')

    // 同版本再存 → 不追加
    await save('agreement', { user: { version: '1.0', sections: [] }, privacy: { version: '1.0', sections: [] } })
    c = bodyOf(await getAdmin('agreement')).content
    expect(c.history.length).toBe(2)

    // 改 user 版本 → 只追 1 条（privacy 不变不追）
    await save('agreement', { user: { version: '2.0', sections: [] }, privacy: { version: '1.0', sections: [] } })
    c = bodyOf(await getAdmin('agreement')).content
    expect(c.history.length).toBe(3)
    expect(c.history[2]).toMatchObject({ part: 'user', version: '2.0' })
  })

  it('大白话：history 封顶 10（保留最新）', async () => {
    for (let i = 1; i <= 12; i++) await save('agreement', { user: { version: 'v' + i, sections: [] }, privacy: { version: 'p0', sections: [] } })
    const c = bodyOf(await getAdmin('agreement')).content
    expect(c.history.length).toBe(10) // 13 次追加（首存 privacy p0 + user v1..v12）→ 保留末 10
    expect(c.history[c.history.length - 1]).toMatchObject({ part: 'user', version: 'v12' })
  })

  it('大白话：并发两次保存同改一份（privacy 各升不同版本），两条历史都保留不丢失（P3 修复：原读-改-写非原子会丢一条）', async () => {
    // 首建：user 1.0 + privacy 1.0 → 2 条 history。两次并发都只改 privacy（user 全程不动，避免 CAS
    // 重试重读时把「别人动过的字段」误判成本轮意图变更——这条边界不是本次修复范围，测试刻意避开）。
    await save('agreement', { user: { version: '1.0', sections: [] }, privacy: { version: '1.0', sections: [] } })

    // 用 beforeUpdate 钩子模拟并发：本轮写库前，另一会话已抢先把 privacy 从 1.0 直接推到 1.5 并落库
    // （原读-改-写非原子实现下：本轮仍攥着旧 history 整体覆盖，1.5 这条追加会被无声吞掉）。
    let injected = false
    control.setBeforeUpdate(async ({ coll }: any) => {
      if (coll === 'content' && !injected) {
        injected = true
        await save('agreement', { user: { version: '1.0', sections: [] }, privacy: { version: '1.5', sections: [] } })
      }
    })
    // 本轮意图把 privacy 推到 2.0（发起时并不知道并发方已经推过 1.5）
    const r = await save('agreement', { user: { version: '1.0', sections: [] }, privacy: { version: '2.0', sections: [] } })
    control.setBeforeUpdate(null as never)

    expect(r.statusCode).toBe(200) // CAS 重试后成功，不因并发抢先而报错
    const c = bodyOf(await getAdmin('agreement')).content
    // 首建 2 条 + 并发方 privacy→1.5 一条 + 本轮 privacy→2.0 一条 = 4 条，一条不少
    // （旧实现：本轮整体覆盖旧 history，1.5 那条会丢，只剩 3 条）
    expect(c.history.length).toBe(4)
    expect(c.history.filter((h: any) => h.part === 'privacy' && h.version === '1.5').length).toBe(1)
    expect(c.history.filter((h: any) => h.part === 'privacy' && h.version === '2.0').length).toBe(1)
    expect(c.privacy.version).toBe('2.0') // 内容本身仍是「后写覆盖」语义（本次只修历史追加的原子性，非内容合并）
  })

  it('大白话：_v CAS 上线前就存在的旧文档（无 _v 字段）保存不永久 CONTENTION（回归·字面量0误判修复）', async () => {
    // 直接建一份「_v 改造前」形态的旧文档：无 _v 字段，模拟本 CAS 机制上线时线上已有的真实存量数据。
    await db().collection('content').doc('agreement').set({
      data: { user: { version: '1.0', sections: [] }, privacy: { version: '1.0', sections: [] }, history: [], updatedAt: 1 },
    })
    const r = await save('agreement', { user: { version: '1.0', sections: [] }, privacy: { version: '2.0', sections: [] } })
    expect(r.statusCode).toBe(200) // 旧实现：where(_v:0) 精确匹配缺失字段恒 updated:0，5 次重试耗尽 409 CONTENTION
    const c = bodyOf(await getAdmin('agreement')).content
    expect(c._v).toBe(1) // 首次经过 CAS 分支成功写入，_v 从此落地
    expect(c.history.filter((h: any) => h.part === 'privacy' && h.version === '2.0').length).toBe(1)
    // 再存一次，确认 _v 字段落地后正常的「有版本号」CAS 分支同样工作正常，不是只对无字段这一次侥幸成功
    const r2 = await save('agreement', { user: { version: '1.0', sections: [] }, privacy: { version: '3.0', sections: [] } })
    expect(r2.statusCode).toBe(200)
    const c2 = bodyOf(await getAdmin('agreement')).content
    expect(c2._v).toBe(2)
  })
})

describe('未知 page 一律拒绝（fail-closed·信任边界·根因#3）', () => {
  it('大白话：admin save/get 未知 page → 400 UNKNOWN_PAGE；app 公开读 → BAD_ARGS', async () => {
    const s = await save('evilPage', { anything: 1 })
    expect(s.statusCode).toBe(400)
    expect(bodyOf(s).error).toBe('UNKNOWN_PAGE')
    const g = await getAdmin('evilPage')
    expect(g.statusCode).toBe(400)
    expect(bodyOf(g).error).toBe('UNKNOWN_PAGE')
    const ar = await appCall('getPageContent', { page: 'evilPage' })
    expect(ar.ok).toBe(false)
    expect(ar.error).toBe('BAD_ARGS')
  })
})

describe('app 公开读（getPageContent·空兜底 + heroImage cloud:// 换址 fileID 不出口）', () => {
  it('大白话：无文档返回 null；catalogPlayer.catalog.heroImage cloud:// 换 https 短时址（同 swapHomeImages 口径）', async () => {
    const r0 = await appCall('getPageContent', { page: 'welcome' })
    expect(r0.ok).toBe(true)
    expect(r0.content).toBe(null)

    await save('catalogPlayer', { catalog: { heroImage: 'cloud://hero.jpg', resumeCta: '继续', emptyLesson: '空' }, help: { faq: [] } })
    const r = await appCall('getPageContent', { page: 'catalogPlayer' })
    expect(r.ok).toBe(true)
    expect(r.content.catalog.heroImage).toBe('https://tmp/cloud://hero.jpg') // 换址后下发·fileID 不出口
    expect(r.page).toBe('catalogPlayer')
  })

  it('大白话：heroImage 已是 https / 非 catalogPlayer 页原样透传，不误换址', async () => {
    await save('about', { lead: '你好', sections: [{ title: '关于', body: '正文' }] })
    const r = await appCall('getPageContent', { page: 'about' })
    expect(r.ok).toBe(true)
    expect(r.content.lead).toBe('你好') // about 页无 heroImage·原样
  })
})

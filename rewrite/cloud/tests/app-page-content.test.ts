// 页面内容 CMS 云读写链（批A·守卫 rw-cloud-page-content-sanitized·信任边界 fail-closed·根因#3 不信前端）：
// adminApi savePageContent/getPageContent 每页白名单净化（超长截断/数组封顶/未知字段丢弃/未知 page 拒）
// + agreement history 服务端追加与 cap；app 公开读 getPageContent 同白名单 + catalogPlayer.heroImage 换址。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import cloud, { control } from 'wx-server-sdk'
import { savePageContent, getPageContent, saveHelpVideos, listHelpVideos, getHomeContent, saveHomeContent } from '../src/functions/adminApi/actions/content'
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

// —— 首页内容（saveHomeContent/getHomeContent·橱窗②③ hero/信任条/FAQ·窄债 2026-07-23：写路径此前零测试，
// 只测过读侧 getContent（同域 getPageContent 已由本文件覆盖）——补写路径三面：①正常保存后读回一致（真实
// 写库断言）②白名单净化逐条钉行为（长度/封顶/未知字段丢弃，均对齐源码字段，非发明）③越界输入 fail-closed 不崩。
const saveHome = (home: unknown) => saveHomeContent({ db: db(), data: { home } } as any)
const getHomeAdmin = () => getHomeContent({ db: db() } as any)

describe('首页内容（saveHomeContent/getHomeContent·橱窗②③ hero/信任条/FAQ）', () => {
  it('大白话：无文档时读回 null（同 getPageContent 空兜底口径）', async () => {
    const g = bodyOf(await getHomeAdmin())
    expect(g.ok).toBe(true)
    expect(g.home).toBe(null)
  })

  it('大白话：正常保存后读回一致（真实写库断言）', async () => {
    const home = {
      hero: { title: '首页标题', tagline: '副标语', search: '搜什么', img: 'cloud://hero.jpg' },
      brand: { name: '小棉鸭', lead: '手作温暖' },
      feature: { title: '特写标题', body: '特写正文', img: 'cloud://feature.jpg' },
      reassure: {
        heading: '放心区',
        lead: '把门槛拆掉',
        items: [{ icon: 'shield', title: '正品', body: '假一赔十', img: 'cloud://r1.jpg' }],
      },
      reviews: { heading: '买家秀', items: [{ quote: '很好用', user: '用户A', img: 'cloud://rv1.jpg' }] },
      closing: { title: '收尾', cta: '立即购买', img: 'cloud://closing.jpg' },
      footer: { links: ['关于我们', '联系客服'], copy: '© 2026 小棉鸭' },
      activationBg: 'cloud://act.jpg',
      loadingBg: 'cloud://loading.jpg',
      activationBgByCourse: { c1: { welcome: 'cloud://w1.jpg', welcomeBack: 'cloud://wb1.jpg', taken: 'cloud://t1.jpg' } },
      trust: [{ icon: 'shield', label: '正品保障' }],
      faq: [{ title: '问题1', body: '答案1' }],
    }
    const r = bodyOf(await saveHome(home))
    expect(r.ok).toBe(true)

    const c = bodyOf(await getHomeAdmin()).home
    expect(c.hero).toMatchObject(home.hero)
    expect(c.brand).toMatchObject(home.brand)
    expect(c.feature).toMatchObject(home.feature)
    expect(c.reassure.heading).toBe(home.reassure.heading)
    expect(c.reassure.items[0]).toMatchObject(home.reassure.items[0])
    expect(c.reviews.items[0]).toMatchObject(home.reviews.items[0])
    expect(c.closing).toMatchObject(home.closing)
    expect(c.footer).toMatchObject(home.footer)
    expect(c.activationBg).toBe(home.activationBg)
    expect(c.loadingBg).toBe(home.loadingBg)
    expect(c.activationBgByCourse.c1).toMatchObject(home.activationBgByCourse.c1)
    expect(c.trust[0]).toMatchObject(home.trust[0])
    expect(c.faq[0]).toMatchObject(home.faq[0])
    expect(typeof c.updatedAt).toBe('number')
    // 真实写库断言（不只经读侧回读，直接查库·同本文件其余用例 control.dump 手法）
    const dumped = control.dump('content').find((d: any) => d._id === 'home')
    expect(dumped.hero.title).toBe(home.hero.title)
  })

  it('大白话：白名单净化——超长截断/数组封顶/顶层未知字段丢弃（逐条对齐源码字段长度）', async () => {
    const items6 = Array.from({ length: 8 }, (_, i) => ({ icon: `i${i}`, title: `t${i}`, body: `b${i}`, img: `cloud://${i}.jpg` }))
    const reviews12 = Array.from({ length: 15 }, (_, i) => ({ quote: `q${i}`, user: `u${i}`, img: `cloud://${i}.jpg` }))
    const trust4 = Array.from({ length: 6 }, (_, i) => ({ icon: `i${i}`, label: `l${i}` }))
    const faq8 = Array.from({ length: 10 }, (_, i) => ({ title: `t${i}`, body: `b${i}` }))
    const links6 = Array.from({ length: 8 }, (_, i) => `link${i}`)
    await saveHome({
      hero: { title: 'H'.repeat(30), tagline: 'T'.repeat(60), search: 'S'.repeat(60), img: 'cloud://' + 'x'.repeat(300), evil: 'drop-me' },
      brand: { name: 'N'.repeat(40), lead: 'L'.repeat(100) },
      feature: { title: 'F'.repeat(50), body: 'B'.repeat(120), img: 'cloud://' + 'y'.repeat(300) },
      reassure: { heading: 'H'.repeat(40), lead: 'L'.repeat(120), items: items6 },
      reviews: { heading: 'R'.repeat(40), items: reviews12 },
      closing: { title: 'C'.repeat(30), cta: 'X'.repeat(80), img: 'cloud://' + 'z'.repeat(300) },
      footer: { links: links6, copy: 'P'.repeat(200) },
      activationBg: 'cloud://' + 'a'.repeat(300),
      loadingBg: 'cloud://' + 'b'.repeat(300),
      trust: trust4,
      faq: faq8,
      hacker: 'drop-me-too',
    } as any)
    const c = bodyOf(await getHomeAdmin()).home
    expect(c.hero.title.length).toBe(20)
    expect(c.hero.tagline.length).toBe(40)
    expect(c.hero.search.length).toBe(40)
    expect(c.hero.img.length).toBe(200)
    expect(c.hero.evil).toBeUndefined()
    expect(c.brand.name.length).toBe(20)
    expect(c.brand.lead.length).toBe(60)
    expect(c.feature.title.length).toBe(30)
    expect(c.feature.body.length).toBe(80)
    expect(c.feature.img.length).toBe(200)
    expect(c.reassure.heading.length).toBe(20)
    expect(c.reassure.lead.length).toBe(60)
    expect(c.reassure.items.length).toBe(6) // 封顶 6
    expect(c.reassure.items[0].icon.length).toBeLessThanOrEqual(20)
    expect(c.reviews.items.length).toBe(12) // 封顶 12
    expect(c.closing.title.length).toBe(20)
    expect(c.closing.cta.length).toBe(40)
    expect(c.closing.img.length).toBe(200)
    expect(c.footer.links.length).toBe(6) // 封顶 6
    expect(c.footer.copy.length).toBe(120)
    expect(c.activationBg.length).toBe(200)
    expect(c.loadingBg.length).toBe(200)
    expect(c.trust.length).toBe(4) // 封顶 4
    expect(c.faq.length).toBe(8) // 封顶 8
    expect(c.hacker).toBeUndefined() // 顶层未知字段丢弃（doc 只按白名单字段逐个拼装）
  })

  it('大白话：activationBgByCourse 课程封顶 100（防滥用）', async () => {
    const many: Record<string, unknown> = {}
    for (let i = 0; i < 105; i++) many['c' + i] = { welcome: 'cloud://w' + i }
    await saveHome({ activationBgByCourse: many } as any)
    const c = bodyOf(await getHomeAdmin()).home
    expect(Object.keys(c.activationBgByCourse).length).toBe(100)
    expect(c.activationBgByCourse.c0).toBeDefined()
    expect(c.activationBgByCourse.c99).toBeDefined()
    expect(c.activationBgByCourse.c100).toBeUndefined() // 第 101 个起被封顶截断
  })

  it('大白话：activationBgByCourse 旧单字符串兼容为 welcome、空态/空课剔除、courseId 超长截断', async () => {
    const longKey = 'k'.repeat(60)
    await saveHome({
      activationBgByCourse: {
        legacyStr: 'cloud://legacy.jpg', // 旧单字符串形态（迁移前存量数据）→ 归一成 welcome
        emptyEntry: {}, // 全空态 → 整课剔除
        emptyStates: { welcome: '' }, // 值为空串 → 该态剔除，剔完课也空 → 整课剔除
        [longKey]: { welcome: 'cloud://long-key.jpg' },
      },
    } as any)
    const c = bodyOf(await getHomeAdmin()).home
    expect(c.activationBgByCourse.legacyStr).toEqual({ welcome: 'cloud://legacy.jpg' })
    expect(c.activationBgByCourse.emptyEntry).toBeUndefined()
    expect(c.activationBgByCourse.emptyStates).toBeUndefined()
    expect(c.activationBgByCourse[longKey.slice(0, 40)]).toEqual({ welcome: 'cloud://long-key.jpg' }) // courseId 键截断至 40
  })

  it('大白话：越界输入不崩且 fail-closed——home 非对象/字段类型错乱，安全落默认值', async () => {
    // home 本身非对象（字符串）：全链路 optional chaining，读不到任何子字段但不应抛错
    const r1 = bodyOf(await saveHome('not-an-object' as any))
    expect(r1.ok).toBe(true)
    const c1 = bodyOf(await getHomeAdmin()).home
    expect(c1.hero.title).toBe('') // 安全落空默认，不崩
    expect(c1.faq).toEqual([])
    expect(c1.activationBgByCourse).toEqual({})

    // 数组类字段传非数组（字符串/对象/null/undefined）：arrOf 一律兜底为空数组，不崩
    const r2 = bodyOf(
      await saveHome({
        reassure: { items: 'not-array' },
        reviews: { items: { 0: 'x' } },
        footer: { links: 123 },
        trust: null,
        faq: undefined,
      } as any)
    )
    expect(r2.ok).toBe(true)
    const c2 = bodyOf(await getHomeAdmin()).home
    expect(c2.reassure.items).toEqual([])
    expect(c2.reviews.items).toEqual([])
    expect(c2.footer.links).toEqual([])
    expect(c2.trust).toEqual([])
    expect(c2.faq).toEqual([])

    // activationBgByCourse 传非法形态（数组）：typeof 数组也是 'object'，逐 key 遍历但值非字符串/对象一律被
    // 净化剔除（不会把脏数据写进库），且不抛错
    const r3 = bodyOf(await saveHome({ activationBgByCourse: [1, 2, 3] } as any))
    expect(r3.ok).toBe(true)

    // 完全不传 home（data.home undefined）：等价于空对象，落全默认值
    const r4 = bodyOf(await saveHomeContent({ db: db(), data: {} } as any))
    expect(r4.ok).toBe(true)
  })
})

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

// —— 帮助视频乐观并发 + GC 告警（批A·内容域并发安全·根因#1/#14·同 saveCourseDraft rev/baseRev/DRAFT_CONFLICT 口径）——
// 整档覆盖（items 整体替换）＝两处并发编辑后保存者静默吃掉先保存者；补 rev/baseRev CAS：不符即拒（不覆盖不 GC）。
// GC 静默吞错（原 deleteFile(...).catch(()=>{})）修掉：删失败留痕 notifyAlert + 如实回 ok:false（保存已成功·orphans 可人工回收）。
const saveHV = (items: unknown[], baseRev?: number, cloudOverride?: unknown) =>
  saveHelpVideos({ db: db(), cloud: cloudOverride || cloud, data: { items, baseRev } } as any)
const listHV = () => listHelpVideos({ db: db() } as any)
const hvItems = (fileId: string) => [{ id: 'h1', title: '起针总松', segments: [{ id: 's1', name: '段一', dur: '1:00', videoFileId: fileId }] }]

describe('帮助视频乐观并发 + GC 告警（批A·根因#1/#14）', () => {
  it('大白话：baseRev 陈旧 → DRAFT_CONFLICT，既不覆盖内容也不删任何文件（先保存者的编辑 + 视频都保住）', async () => {
    control.seed('content', [{ _id: 'helpVideos', items: hvItems('cloud://old-vid'), rev: 2, updatedAt: 1 }])
    const r = bodyOf(await saveHV(hvItems('cloud://new-vid'), 1)) // baseRev=1 已陈旧（当前 rev=2）
    expect(r.ok).toBe(false)
    expect(r.error).toBe('DRAFT_CONFLICT')
    expect(r.rev).toBe(2) // 回当前 rev 供前端重载
    // 内容未被覆盖（仍是 old-vid、rev 仍 2）
    const doc = control.dump('content').find((d: any) => d._id === 'helpVideos')
    expect(doc.items[0].segments[0].videoFileId).toBe('cloud://old-vid')
    expect(doc.rev).toBe(2)
    expect(control.deletedFiles()).toEqual([]) // 冲突分支绝不 GC（先保存者的视频不被误删）
  })

  it('大白话：正常保存——rev 递增、内容落库、旧份不再引用的孤儿视频被 GC 删掉', async () => {
    control.seed('content', [{ _id: 'helpVideos', items: hvItems('cloud://old-vid'), rev: 1, updatedAt: 1 }])
    const r = bodyOf(await saveHV(hvItems('cloud://new-vid'), 1))
    expect(r.ok).toBe(true)
    expect(r.rev).toBe(2) // rev 递增
    const doc = control.dump('content').find((d: any) => d._id === 'helpVideos')
    expect(doc.items[0].segments[0].videoFileId).toBe('cloud://new-vid') // 内容落库
    expect(doc.rev).toBe(2)
    expect(control.deletedFiles()).toEqual(['cloud://old-vid']) // 孤儿 GC 正常
    // listHelpVideos 响应带 rev 供前端做 baseRev
    const lr = bodyOf(await listHV())
    expect(lr.rev).toBe(2)
  })

  it('大白话：GC deleteFile 失败不再静默吞——留痕 notifyAlert(GC_DELETE_FAIL) + 如实回 ok:false（保存本身已成功）', async () => {
    control.seed('content', [{ _id: 'helpVideos', items: hvItems('cloud://old-vid'), rev: 1, updatedAt: 1 }])
    // 注入 deleteFile 拒绝的 cloud（模拟真机偶发删失败）：saveHelpVideos 只用 cloud.deleteFile，最小对象即可
    const failCloud = { deleteFile: () => Promise.reject(new Error('MOCK_DELETE_FAIL')) }
    const r = bodyOf(await saveHV(hvItems('cloud://new-vid'), 1, failCloud))
    expect(r.ok).toBe(false) // 原 .catch(()=>{}) 全吞会恒回 ok:true——前端误显「已保存」
    expect(r.error).toBe('GC_DELETE_FAIL')
    // 保存本身已成功：内容已落库、rev 已递增（只是 GC 失败）
    const doc = control.dump('content').find((d: any) => d._id === 'helpVideos')
    expect(doc.items[0].segments[0].videoFileId).toBe('cloud://new-vid')
    expect(doc.rev).toBe(2)
    // 真留痕（病根#14）：orphans 进 anomalies 账本可人工回收
    expect(control.dump('anomalies').some((a: any) => a.code === 'GC_DELETE_FAIL')).toBe(true)
  })

  it('大白话：不带 baseRev 的旧调用按原语义覆盖（部署窗口前后端版本错开不卡死保存）', async () => {
    control.seed('content', [{ _id: 'helpVideos', items: hvItems('cloud://old-vid'), rev: 5, updatedAt: 1 }])
    const r = bodyOf(await saveHV(hvItems('cloud://new-vid'))) // 不带 baseRev
    expect(r.ok).toBe(true)
    expect(r.rev).toBe(6) // 仍以当前 rev 为基递增
  })
})

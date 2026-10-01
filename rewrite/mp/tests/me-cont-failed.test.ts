// 「我」页继续学习区失败分治（深审 20260712 P2：取数失败伪装空态）：progress/mine/courses 任一
// 失败时空列表与「真没进度/没买课」形状等价，直接喂 continueResolve 会渲染「还没有学习记录」假空态。
// 钉行为：失败 → contFailed 亮（给重试）·不覆盖已有 cont；全成功无课 → 真空态引导保留（contFailed 灭）。
// 加载提速：卡不等人资料/CMS；有旧卡不拉回骨架；继续学习只取所需课（不拉整本 getAllCourses）。
// Page 以全局桩捕获 options（node 环境无小程序运行时·同 cart/catalog 测试 wx 桩家风）。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { loginGate } from '../lib/loginGate'
import { mapMe } from '../lib/mapMe'

// 性能批 #1/#4：我的课 + 进度并成一次 getMyLearning（progress:null＝进度读失败）；订单格数字一次 countMyOrders
const { loginMock, getMyLearningMock, getCoursesByIdsMock, getPageContentMock, countMyOrdersMock } = vi.hoisted(() => ({
  countMyOrdersMock: vi.fn(),
  loginMock: vi.fn(),
  getMyLearningMock: vi.fn(),
  getCoursesByIdsMock: vi.fn(),
  getPageContentMock: vi.fn(),
}))
vi.mock('../api/user', () => ({ login: loginMock, deleteAccount: vi.fn() }))
vi.mock('../api/learning', () => ({ getMyLearning: getMyLearningMock }))
vi.mock('../api/orders', () => ({ countMyOrders: countMyOrdersMock }))
vi.mock('../lib/courses', () => ({ getCoursesByIds: getCoursesByIdsMock, getAllCourses: vi.fn() }))
// 合流补桩（页面内容 CMS 战役后 me.ts 并入 getPageContent('mePage')·本测试只钉 cont 分治，CMS 内容走默认 null）
vi.mock('../lib/pageContent', () => ({ getPageContent: getPageContentMock, __resetForTest: () => {} }))

let pageOpts: Record<string, any> = {}
;(globalThis as any).Page = (o: unknown) => {
  pageOpts = o as Record<string, any>
}

const CONT_KEY = 'ld:me-cont'
const COURSES = [
  { id: 'c1', title: '小棉鸭', chapters: [{ id: 'ch1', lessons: [{ id: 'l1', name: '起针', segments: [] }] }] },
]
const STORED = { courseId: 'c1', courseTitle: '小棉鸭', lessonId: 'l1', lessonName: '起针', segmentId: '', resumeAt: 0 }

let store: Record<string, unknown> = {}

async function flush() {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}

// 每个 it 重置模块拿全新 Page options（me.ts 顶层即调 Page·防跨用例沾 _seq/data）
async function mountMe(): Promise<Record<string, any>> {
  vi.resetModules()
  await import('../pages/me/me')
  const page = Object.create(pageOpts) as Record<string, any>
  page.data = { ...pageOpts.data }
  page.setData = function (patch: Record<string, unknown>) {
    Object.assign(this.data as Record<string, unknown>, patch)
  }
  return page
}

beforeEach(() => {
  store = {}
  ;(globalThis as any).wx = {
    getStorageSync: (k: string) => store[k],
    setStorageSync: (k: string, v: unknown) => {
      store[k] = v
    },
    removeStorageSync: (k: string) => {
      delete store[k]
    },
    getWindowInfo: () => ({ statusBarHeight: 20 }),
  }
  loginMock.mockReset().mockResolvedValue({ ok: true, user: { nickname: '鸭' } })
  getMyLearningMock.mockReset().mockResolvedValue({ ok: true, courses: [], progress: [] })
  getCoursesByIdsMock.mockReset().mockResolvedValue(COURSES)
  getPageContentMock.mockReset().mockResolvedValue(null)
  countMyOrdersMock.mockReset().mockResolvedValue({ ok: true, counts: { pending: 0, paid: 0, shipped: 0 } })
})

describe('继续学习区失败分治（失败≠没进度·同 aftersales/order-list loadFailed 范式）', () => {
  it('大白话：进度/我的课/所需课程任一拉取失败 → contFailed 亮起给重试，不渲染「还没有学习记录」假空态', async () => {
    getMyLearningMock.mockResolvedValue({ ok: true, courses: [], progress: null }) // 进度读失败＝progress:null
    const p1 = await mountMe()
    await p1.refresh()
    await flush()
    expect(p1.data.contFailed).toBe(true) // 失败态·不是空态
    expect(p1.data.cont).toBeNull()

    getMyLearningMock.mockResolvedValue({ ok: false, error: 'NETWORK' }) // 我的课挂＝整包失败
    const p2 = await mountMe()
    await p2.refresh()
    await flush()
    expect(p2.data.contFailed).toBe(true)

    getMyLearningMock.mockResolvedValue({ ok: true, courses: [], progress: [{ courseId: 'c1', last: { lessonId: 'l1' }, updatedAt: 100 }] })
    getCoursesByIdsMock.mockResolvedValue(null) // 有进度才去取课·取失败＝失败态
    const p3 = await mountMe()
    await p3.refresh()
    await flush()
    expect(p3.data.contFailed).toBe(true)
  })

  it('大白话：全都成功但真没课没进度 → 仍是正常空态引导（cont 空·contFailed 灭），不误亮失败态、不拉课程', async () => {
    const page = await mountMe()
    await page.refresh()
    await flush()
    expect(page.data.cont).toBeNull()
    expect(page.data.contFailed).toBe(false)
    expect(getCoursesByIdsMock).toHaveBeenCalledTimes(0) // 没进度没课·不必取目录
  })

  it('大白话：成功定位到课 → cont 落卡片、contFailed 灭；随后一次刷新失败 → 不清掉已有卡片、不亮失败态', async () => {
    getMyLearningMock.mockResolvedValue({ ok: true, courses: [], progress: [{ courseId: 'c1', last: { lessonId: 'l1' }, updatedAt: 100 }] })
    const page = await mountMe()
    await page.refresh()
    await flush()
    expect(page.data.cont).toMatchObject({ courseId: 'c1', lessonId: 'l1' })
    expect(page.data.contFailed).toBe(false)

    getMyLearningMock.mockResolvedValue({ ok: true, courses: [], progress: null }) // 进度读失败＝progress:null
    await page.refresh()
    await flush()
    expect(page.data.cont).toMatchObject({ courseId: 'c1', lessonId: 'l1' }) // 失败不覆盖已有数据（黄金 §八）
    expect(page.data.contFailed).toBe(false) // 还有旧卡可看·不亮失败态
  })
})

// Bug C（2026-07-13 用户反馈「继续学习卡先显示无课程、再变历史记录」·闪空态）：缺「加载中」中间态——
// cont=null 同时表示「尚未加载」和「确认无课」，首帧落到空态；须加 contLoaded，空态只在加载完且真无课才现。
describe('继续学习区加载中态分治（加载中≠没课·消首帧假空态闪烁·根因#8/#14）', () => {
  it('大白话：初始 data 里无旧卡时 contLoaded 为 false（首帧未加载完·不许渲染「还没有学习记录」空态）', async () => {
    const page = await mountMe() // mountMe 返回 refresh 前的初始 data 副本
    expect(page.data.contLoaded).toBe(false)
  })
  it('大白话：refresh 完成后 contLoaded 置 true（成功/失败任一路都置·空态从此才可能出现）', async () => {
    const page = await mountMe()
    await page.refresh()
    await flush()
    expect(page.data.contLoaded).toBe(true)
    // 失败路也须置 true（否则失败时也卡在骨架）
    getMyLearningMock.mockResolvedValue({ ok: true, courses: [], progress: null }) // 进度读失败＝progress:null
    const page2 = await mountMe()
    await page2.refresh()
    await flush()
    expect(page2.data.contLoaded).toBe(true)
  })
})

describe('继续学习卡不等人资料/不拉整本树/旧卡先画（根因#15）', () => {
  it('大白话：login / CMS 还没回来，继续学习卡已经能落（那两路只喂头像昵称和入口）', async () => {
    let resolveLogin!: (v: unknown) => void
    loginMock.mockReturnValue(
      new Promise((r) => {
        resolveLogin = r
      })
    )
    getMyLearningMock.mockResolvedValue({ ok: true, courses: [], progress: [{ courseId: 'c1', last: { lessonId: 'l1' }, updatedAt: 100 }] })
    const page = await mountMe()
    const done = page.refresh()
    await flush()
    expect(page.data.cont).toMatchObject({ courseId: 'c1', lessonId: 'l1' })
    expect(page.data.contLoaded).toBe(true)
    resolveLogin({ ok: true, user: { nickname: '鸭' } })
    await done
  })

  it('大白话：已有 cont 再 refresh，中途不把卡片清掉（不把骨架拉回来）', async () => {
    getMyLearningMock.mockResolvedValue({ ok: true, courses: [], progress: [{ courseId: 'c1', last: { lessonId: 'l1' }, updatedAt: 100 }] })
    const page = await mountMe()
    await page.refresh()
    await flush()
    expect(page.data.cont).toMatchObject({ courseId: 'c1' })

    getMyLearningMock.mockReturnValue(new Promise(() => {})) // 挂住第二趟
    void page.refresh()
    expect(page.data.cont).toMatchObject({ courseId: 'c1' }) // 旧卡还在
    expect(page.data.contLoaded).toBe(true)
  })

  it('大白话：上次会话存了 ContinueTarget → 首帧直接画旧卡（contLoaded 真），不先骨架', async () => {
    store[CONT_KEY] = STORED
    const page = await mountMe()
    expect(page.data.cont).toMatchObject({ courseId: 'c1', lessonId: 'l1' })
    expect(page.data.contLoaded).toBe(true)
  })

  it('大白话：刷新成功落到真没课 → 清掉旧卡和本地存档（不把失败装成空态的反面：真空就要空）', async () => {
    store[CONT_KEY] = STORED
    const page = await mountMe()
    expect(page.data.cont).toBeTruthy()
    await page.refresh()
    await flush()
    expect(page.data.cont).toBeNull()
    expect(page.data.contFailed).toBe(false)
    expect(store[CONT_KEY]).toBeUndefined()
  })

  it('大白话：刷新失败时不覆盖本地旧卡存档（失败≠空）', async () => {
    store[CONT_KEY] = STORED
    getMyLearningMock.mockResolvedValue({ ok: true, courses: [], progress: null }) // 进度读失败＝progress:null
    const page = await mountMe()
    await page.refresh()
    await flush()
    expect(page.data.cont).toMatchObject({ courseId: 'c1', lessonId: 'l1' })
    expect(page.data.contFailed).toBe(false)
    expect(store[CONT_KEY]).toEqual(STORED)
  })
})

// 登录态首帧（2026-09-14）：loggedIn/nickname 写死未登录，本地 hint 已同意仍先闪「欢迎来到小棉鸭 / 点击登录」。
// 镜像 contLoaded：初始 data 从 loginGate.hasAgreed + mapMe(null).defaultNickname 预填，不等云回包。
describe('我页登录态首帧（本地已同意不先闪登出·根因#8/#14）', () => {
  it('大白话：本地 loginGate 已同意 → 首帧 loggedIn 真、昵称先用默认名，不等人资料云回包', async () => {
    loginGate.markAgreed() // 走真实「同意登录」路径写本地 hint，不依赖内部存储键名
    const page = await mountMe()
    expect(page.data.loggedIn).toBe(true)
    expect(page.data.nickname).toBe(mapMe(null).defaultNickname)
  })

  it('大白话：本地未同意 → 首帧仍是登出态，不误显示已登录', async () => {
    const page = await mountMe()
    expect(page.data.loggedIn).toBe(false)
    expect(page.data.nickname).toBe(mapMe(null).defaultNickname)
  })

  it('大白话：已同意但 login() 还没回来 → 首帧已经是登录态，不会先画「欢迎来到小棉鸭」', async () => {
    loginGate.markAgreed() // 走真实「同意登录」路径写本地 hint，不依赖内部存储键名
    loginMock.mockReturnValue(new Promise(() => {}))
    const page = await mountMe()
    void page.refresh()
    await flush()
    expect(page.data.loggedIn).toBe(true)
    expect(page.data.nickname).toBe(mapMe(null).defaultNickname)
  })
})

describe('「我」页小鸭蛋孵化判定（v5 D1·有一门课全部段看完才孵化）', () => {
  const SEGS = [
    { id: 'c1', title: '小棉鸭', chapters: [{ id: 'ch1', lessons: [{ id: 'l1', name: '起针', segments: [{ id: 's1', hasVideo: true }, { id: 's2', hasVideo: true }] }] }] },
  ]
  async function hatchKeyWith(progressList: unknown[]): Promise<string> {
    getMyLearningMock.mockResolvedValue({ ok: true, courses: [], progress: progressList })
    const page = await mountMe()
    await page.refresh()
    await flush()
    return page.data.hatchKey
  }
  it('大白话：全部段 done → hatchKey=该课 id；差一段 / 课没有段 → 不孵化（空串）', async () => {
    getCoursesByIdsMock.mockResolvedValue(SEGS)
    expect(await hatchKeyWith([{ courseId: 'c1', done: { s1: true, s2: 1, stale: true } }])).toBe('c1')
    expect(await hatchKeyWith([{ courseId: 'c1', done: { s1: true, stale: true } }])).toBe('')
    getCoursesByIdsMock.mockResolvedValue(COURSES) // 课时无段：分母 0 不算学完
    expect(await hatchKeyWith([{ courseId: 'c1', done: {} }])).toBe('')
  })
})

describe('订单格数字（v5 D1）', () => {
  it('大白话：三态数字一次往返（性能批 #1）；云端某一态 count 失败给 null——只那一格不显示数字，其它格照常；整个调用抛错——三格都不显示，不冒未处理异常', async () => {
    countMyOrdersMock.mockResolvedValue({ ok: true, counts: { pending: 2, paid: null, shipped: 0 } })
    const page = await mountMe()
    await page.refresh()
    await vi.waitFor(() => expect(page.data.counts).toEqual({ pending: '2', paid: '', shipped: '0' }))
    expect(countMyOrdersMock).toHaveBeenCalledTimes(1)

    countMyOrdersMock.mockRejectedValue(new Error('boom'))
    const page2 = await mountMe()
    await page2.refresh()
    await vi.waitFor(() => expect(page2.data.counts).toEqual({ pending: '', paid: '', shipped: '' }))
  })
})

describe('继续学习卡下行（v5 D1）', () => {
  it('大白话：刷新落卡后下行带节号「1.1 起针」；这门课每段都看完了改写「全部学完 · 可以重看」', async () => {
    getMyLearningMock.mockResolvedValue({ ok: true, courses: [], progress: [{ courseId: 'c1', last: { lessonId: 'l1' }, updatedAt: 100 }] })
    const page = await mountMe()
    await page.refresh()
    await flush()
    expect(page.data.contMain).toBe('1.1 起针')

    const segs = [{ id: 'c1', title: '小棉鸭', chapters: [{ id: 'ch1', lessons: [{ id: 'l1', name: '起针', segments: [{ id: 's1', hasVideo: true }] }] }] }]
    getCoursesByIdsMock.mockResolvedValue(segs)
    getMyLearningMock.mockResolvedValue({ ok: true, courses: [], progress: [{ courseId: 'c1', last: { lessonId: 'l1' }, done: { s1: true }, updatedAt: 100 }] })
    await page.refresh()
    await flush()
    expect(page.data.contMain).toBe('全部学完 · 可以重看')
  })
})

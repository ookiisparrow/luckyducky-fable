// 过期回包不写脏页：评价列表刷新/翻页、播放页装课、编辑资料页 login 回包——驱动真实并发与退页时序，
// 断言旧回包落地后页面数据仍是新的。另：售后单没有商品图，空灰块连样式一起删掉（静态标记）。
// Page 桩同 me-cont-failed.test.ts。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import aftersalesWxml from '../pages/aftersales/aftersales.wxml?raw'
import aftersalesWxss from '../pages/aftersales/aftersales.wxss?raw'

const { getReviewsMock, loginMock, courseMock, urlMock } = vi.hoisted(() => ({
  getReviewsMock: vi.fn(),
  loginMock: vi.fn(),
  courseMock: vi.fn(),
  urlMock: vi.fn(),
}))
vi.mock('../api/reviews', () => ({ getReviews: getReviewsMock }))
vi.mock('../api/user', () => ({ login: loginMock, updateProfile: vi.fn() }))
vi.mock('../api/learning', () => ({ trackEvent: vi.fn(), getHelpVideos: vi.fn(), getPublicFaq: vi.fn(), getPlaybackUrl: urlMock }))
vi.mock('../lib/courses', () => ({ getCourseByIdDetailed: courseMock }))
vi.mock('../lib/pageContent', () => ({ getPageContent: vi.fn().mockResolvedValue(null) }))
vi.mock('../utils/customerService', () => ({ openCustomerService: vi.fn() }))
vi.mock('../lib/nav', () => ({ goBackOrHome: vi.fn() }))

let pageOpts: Record<string, any> = {}
;(globalThis as any).Page = (o: unknown) => {
  pageOpts = o as Record<string, any>
}

async function mount(path: string): Promise<Record<string, any>> {
  vi.resetModules()
  await import(path)
  const page = Object.create(pageOpts) as Record<string, any>
  page.data = { ...pageOpts.data }
  page.setData = function (patch: Record<string, unknown>, cb?: () => void) {
    for (const [k, v] of Object.entries(patch)) {
      const m = k.match(/^(\w+)\[(\d+)\]$/)
      if (m) (this.data as any)[m[1]][Number(m[2])] = v
      else (this.data as any)[k] = v
    }
    if (cb) cb()
  }
  return page
}

function deferred<T = unknown>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}
const review = (name: string) => ({ name, rating: 5 })
const names = (page: Record<string, any>) => page.data.list.map((r: { name: string }) => r.name)

beforeEach(() => {
  getReviewsMock.mockReset()
  loginMock.mockReset()
  courseMock.mockReset()
  urlMock.mockReset().mockImplementation(async (_c: string, s: string) => ({ ok: true, url: 'https://v/' + s }))
  ;(globalThis as any).wx = {
    showToast: vi.fn(),
    vibrateShort: vi.fn(),
    createVideoContext: () => ({ play: vi.fn(), seek: vi.fn() }),
    getWindowInfo: () => ({ statusBarHeight: 20, windowWidth: 375, windowHeight: 700 }),
    getStorageSync: () => undefined,
    setStorageSync: vi.fn(),
  }
})

describe('评价列表过期回包', () => {
  it('大白话：两次刷新并发、先发的后回——旧回包丢掉，列表停在新一次的结果', async () => {
    const old = deferred()
    getReviewsMock.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ ok: true, list: [review('新')], summary: null, nextCursor: null, hasMore: false })
    const page = await mount('../pages/reviews/reviews')
    const first = page.reload()
    await page.reload()
    old.resolve({ ok: true, list: [review('旧')], summary: null, nextCursor: 'c9', hasMore: true })
    await first
    expect(names(page)).toEqual(['新'])
    expect(page.data.hasMore).toBe(false)
  })

  it('大白话：翻页在途时列表被刷新——翻页回包作废，不接到新列表后面', async () => {
    getReviewsMock.mockResolvedValueOnce({ ok: true, list: [review('一')], summary: null, nextCursor: 'c1', hasMore: true })
    const page = await mount('../pages/reviews/reviews')
    await page.reload()
    const more = deferred()
    getReviewsMock.mockReturnValueOnce(more.promise).mockResolvedValueOnce({ ok: true, list: [review('刷新后')], summary: null, nextCursor: null, hasMore: false })
    const p = page.onReachBottom()
    await page.reload()
    more.resolve({ ok: true, list: [review('旧页二')], summary: null, nextCursor: null, hasMore: false })
    await p
    expect(names(page)).toEqual(['刷新后'])
  })

  // 反序：翻页若自己 bump 代次，会把在途刷新判成过期丢掉——loading 卡死、旧列表被接上下一页。
  it('大白话：刷新在途时触底翻页——翻页不另起代次，刷新回包照常落地', async () => {
    getReviewsMock.mockResolvedValueOnce({ ok: true, list: [review('一')], summary: null, nextCursor: 'c1', hasMore: true })
    const page = await mount('../pages/reviews/reviews')
    await page.reload()
    const r = deferred()
    getReviewsMock.mockReturnValueOnce(r.promise).mockResolvedValueOnce({ ok: true, list: [review('二')], summary: null, nextCursor: null, hasMore: false })
    page.onRetryLoad()
    await page.onReachBottom()
    r.resolve({ ok: true, list: [review('刷新')], summary: null, nextCursor: null, hasMore: false })
    await new Promise((done) => setTimeout(done, 0))
    expect(names(page)).toEqual(['刷新'])
    expect(page.data.loading).toBe(false)
  })
})

describe('播放页装课过期回包', () => {
  const course = (title: string) => ({
    id: 'c1',
    title,
    chapters: [{ id: 'ch1', lessons: [{ id: 'l1', name: '起针', segments: [{ id: 's1', hasVideo: true }] }] }],
  })

  it('大白话：点了重试又装一次课、先发的那次后回——旧课丢掉，不覆盖新标题', async () => {
    const old = deferred()
    courseMock.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ failed: false, course: course('新课') })
    const page = await mount('../pages/player/player')
    page.courseId = 'c1'
    page.measureSeekRect = vi.fn()
    const first = page.initCourse()
    await page.initCourse()
    old.resolve({ failed: false, course: course('旧课') })
    await first
    expect(page.data.title).toBe('新课')
  })

  it('大白话：装课回包时人已经退出播放页——什么都不写', async () => {
    const d = deferred()
    courseMock.mockReturnValueOnce(d.promise)
    const page = await mount('../pages/player/player')
    page.courseId = 'c1'
    const before = { ...page.data }
    const p = page.initCourse()
    page.onUnload()
    d.resolve({ failed: true, course: null })
    await p
    expect(page.data).toEqual(before)
  })
})

describe('编辑资料页 login 迟到回包', () => {
  it('大白话：资料还在拉、人已经走了——回包不再写到页面上', async () => {
    const d = deferred()
    loginMock.mockReturnValueOnce(d.promise)
    const page = await mount('../pages/profile-edit/profile-edit')
    const p = page.onLoad()
    page.onUnload()
    d.resolve({ ok: true, user: { nickname: '棉棉', phone: '13800138000' } })
    await p
    expect(page.data).toMatchObject({ nickname: '', loaded: false, loading: true })
  })
})

describe('售后空图', () => {
  // 静态标记断言（wxml/wxss 无运行时可挂载）：售后单永远没有商品图，空灰块的节点和样式都不该回来。
  it('大白话：售后单永远没有商品图，空灰块连样式一起删掉', () => {
    expect(aftersalesWxml.replace(/<!--[\s\S]*?-->/g, '')).not.toMatch(/coas-order-img/)
    expect(aftersalesWxss.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/coas-order-img/)
  })
})

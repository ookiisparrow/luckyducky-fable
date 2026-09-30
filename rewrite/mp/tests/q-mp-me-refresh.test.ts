// 「我」tab 切回去重：每次 onShow 都发 login+CMS+进度+我的课（+课程）4-5 次云调用；30 秒内切回且登录态没变不重拉。
// 首次进入、上次没拉全、登录态变了、去改资料/看课/激活回来，照旧重拉。重试按钮和登录回调直接 refresh，不受影响。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { RETURN_SETTLE_MS } from '../lib/nav'

const { loginMock, getMyProgressMock, getMyCoursesMock } = vi.hoisted(() => ({
  loginMock: vi.fn(),
  getMyProgressMock: vi.fn(),
  getMyCoursesMock: vi.fn(),
}))
vi.mock('../api/user', () => ({ login: loginMock, getMyProgress: getMyProgressMock, deleteAccount: vi.fn() }))
vi.mock('../api/learning', () => ({ getMyCourses: getMyCoursesMock }))
vi.mock('../lib/courses', () => ({ getCoursesByIds: async () => [] }))
vi.mock('../lib/pageContent', () => ({ getPageContent: async () => null }))

let store: Record<string, unknown> = {}
let now = 1_000_000
beforeEach(() => {
  store = { ld_login_hint: true }
  now = 1_000_000
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  ;(globalThis as any).wx = {
    getStorageSync: (k: string) => store[k],
    setStorageSync: (k: string, v: unknown) => (store[k] = v),
    removeStorageSync: (k: string) => delete store[k],
    getWindowInfo: () => ({ statusBarHeight: 20 }),
    navigateTo: vi.fn(),
    switchTab: vi.fn(),
  }
  loginMock.mockReset().mockResolvedValue({ ok: true, user: { nickname: '鸭' } })
  getMyProgressMock.mockReset().mockResolvedValue({ ok: true, list: [] })
  getMyCoursesMock.mockReset().mockResolvedValue({ ok: true, list: [] })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

async function mountMe(): Promise<Record<string, any>> {
  let opts: Record<string, any> = {}
  ;(globalThis as any).Page = (o: Record<string, any>) => (opts = o)
  vi.resetModules()
  await import('../pages/me/me')
  const page = Object.create(opts) as Record<string, any>
  page.data = { ...opts.data }
  page.setData = function (patch: Record<string, unknown>) {
    Object.assign(this.data as Record<string, unknown>, patch)
  }
  return page
}

// 回到本页的刷新等返回动画走完（lib/nav afterReturn·切页掉帧 2026-10-01）：页面在栈里、拨过 RETURN_SETTLE_MS
async function show(page: Record<string, any>) {
  ;(globalThis as any).getCurrentPages = () => [page]
  page.onShow()
  vi.advanceTimersByTime(RETURN_SETTLE_MS)
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

describe('「我」tab onShow 短时去重', () => {
  it('大白话：首次进入照常拉；30 秒内切回不再拉；过了 30 秒切回再拉', async () => {
    const page = await mountMe()
    await show(page)
    expect(loginMock).toHaveBeenCalledTimes(1)
    expect(getMyProgressMock).toHaveBeenCalledTimes(1)
    now += 29_000
    await show(page)
    expect(loginMock).toHaveBeenCalledTimes(1)
    expect(getMyCoursesMock).toHaveBeenCalledTimes(1)
    now += 2_000
    await show(page)
    expect(loginMock).toHaveBeenCalledTimes(2)
  })

  it('大白话：上次继续学习区没拉到——切回马上重拉，不把失败缓存 30 秒', async () => {
    getMyProgressMock.mockResolvedValueOnce({ ok: false, error: 'CALL_TIMEOUT' })
    const page = await mountMe()
    await show(page)
    await show(page)
    expect(getMyProgressMock).toHaveBeenCalledTimes(2)
  })

  it('大白话：上次登录（资料）没拉到——切回马上重拉', async () => {
    loginMock.mockResolvedValueOnce({ ok: false, error: 'CALL_FAIL' })
    const page = await mountMe()
    await show(page)
    await show(page)
    expect(loginMock).toHaveBeenCalledTimes(2)
  })

  it('大白话：登录状态变了（在别的页登录/退出）——切回强制重拉', async () => {
    const page = await mountMe()
    await show(page)
    store.ld_login_hint = false
    await show(page)
    expect(loginMock).toHaveBeenCalledTimes(2)
  })

  it('大白话：去改资料 / 看课回来——切回强制重拉（昵称、继续学习卡可能变了）', async () => {
    const page = await mountMe()
    await show(page)
    let n = 1
    for (const go of ['onEditProfile', 'onCourses', 'onContinue']) {
      page[go]()
      await show(page)
      expect(loginMock, go).toHaveBeenCalledTimes(++n)
    }
  })

  it('大白话：刚进「我」页还在加载就点去改资料——那趟加载晚到也不能把「回来要重拉」抵消掉', async () => {
    for (const go of ['onEditProfile', 'onCourses', 'onContinue']) {
      loginMock.mockReset()
      let resolveLogin: (v: unknown) => void = () => {}
      loginMock.mockImplementationOnce(() => new Promise((r) => (resolveLogin = r))).mockResolvedValue({ ok: true, user: { nickname: '鸭' } })
      const page = await mountMe()
      await show(page) // 加载在途：login 未回
      page[go]()
      resolveLogin({ ok: true, user: { nickname: '鸭' } })
      for (let i = 0; i < 10; i++) await Promise.resolve()
      now += 20_000
      await show(page)
      expect(loginMock, go).toHaveBeenCalledTimes(2)
    }
  })

  it('大白话：重试按钮、登录成功回调不受去重影响，点了就拉', async () => {
    const page = await mountMe()
    await show(page)
    page.onRetryCont()
    page.onLoggedIn()
    expect(loginMock).toHaveBeenCalledTimes(3)
  })

  it('大白话：去订单列表 / 售后回来——切回重拉（订单格数字要跟上）', async () => {
    const page = await mountMe()
    await show(page)
    page.onOrders({ currentTarget: { dataset: { tab: 'pending' } } })
    await show(page)
    expect(loginMock).toHaveBeenCalledTimes(2)
    page.onAfterSales()
    await show(page)
    expect(loginMock).toHaveBeenCalledTimes(3)
  })
})

describe('「我」页资料显示', () => {
  it('大白话：已登录但这次资料没拉到——名字和头像保留刚才显示的，不刷回「钩织新手」', async () => {
    loginMock.mockResolvedValue({ ok: true, user: { nickname: '棉棉', avatar: 'cloud://a' } })
    const page = await mountMe()
    await show(page)
    expect(page.data).toMatchObject({ nickname: '棉棉', avatar: 'cloud://a' })
    loginMock.mockResolvedValue({ ok: false, error: 'CALL_FAIL' })
    await page.refresh()
    expect(page.data).toMatchObject({ nickname: '棉棉', avatar: 'cloud://a', loggedIn: true })
  })

  it('大白话：退出登录后照常回默认名（不是保留旧资料）', async () => {
    loginMock.mockResolvedValue({ ok: true, user: { nickname: '棉棉' } })
    const page = await mountMe()
    await show(page)
    store.ld_login_hint = false
    loginMock.mockResolvedValue({ ok: false, error: 'CALL_FAIL' })
    await page.refresh()
    expect(page.data).toMatchObject({ nickname: '钩织新手', loggedIn: false })
  })

  it('大白话：半屏里登录成功——头部马上切成登录态，不等资料回来', async () => {
    store.ld_login_hint = false
    const page = await mountMe()
    loginMock.mockImplementation(() => new Promise(() => undefined))
    page.onLoggedIn()
    expect(page.data.loggedIn).toBe(true)
  })

  it('大白话：客服入口叫「联系客服」', async () => {
    const { mapMe } = await import('../lib/mapMe')
    expect(mapMe(null).entries.kefu.label).toBe('联系客服')
  })
})

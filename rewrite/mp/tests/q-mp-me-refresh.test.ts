// 「我」tab 切回去重：每次 onShow 都发 login+CMS+进度+我的课（+课程）4-5 次云调用；30 秒内切回且登录态没变不重拉。
// 首次进入、上次没拉全、登录态变了、去改资料/看课/激活回来，照旧重拉。重试按钮和登录回调直接 refresh，不受影响。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

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
afterEach(() => vi.restoreAllMocks())

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

async function show(page: Record<string, any>) {
  page.onShow()
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

  it('大白话：去改资料 / 激活 / 看课回来——切回强制重拉（昵称、继续学习卡可能变了）', async () => {
    const page = await mountMe()
    await show(page)
    let n = 1
    for (const go of ['onEditProfile', 'onActivate', 'onCourses', 'onContinue']) {
      page[go]()
      await show(page)
      expect(loginMock, go).toHaveBeenCalledTimes(++n)
    }
  })

  it('大白话：刚进「我」页还在加载就点去改资料——那趟加载晚到也不能把「回来要重拉」抵消掉', async () => {
    for (const go of ['onEditProfile', 'onActivate', 'onCourses', 'onContinue']) {
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
})

// 激活页行为：扫码带码自动兑课、手输码（去空白转大写·空码拦截）、五种结果屏（新激活取背景图与课程名 /
// 欢迎回来 / 已被使用 / 废码 / 网络类可原码重试）、确认进课成败与跳转、在途防重、退页后迟到回包不动页面、
// 自绘返回与「先逛逛」出口、CMS 文案到达。只桩云调用（callApp），api/lib 用真的。Page 桩同 p-mp-order-page.test.ts。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ACTIVATION_ERR_COPY } from '../lib/mapLearning'

const { callAppMock } = vi.hoisted(() => ({ callAppMock: vi.fn() }))
vi.mock('../utils/cloud', () => ({ callApp: callAppMock }))
vi.mock('../lib/haptics', () => ({ tapHaptic: vi.fn() }))
const { openCsMock } = vi.hoisted(() => ({ openCsMock: vi.fn() }))
vi.mock('../utils/customerService', () => ({ openCustomerService: openCsMock }))

let pageOpts: Record<string, any> = {}
;(globalThis as any).Page = (o: unknown) => {
  pageOpts = o as Record<string, any>
}

const HOME = { activationBg: 'https://img/global.png', activationBgByCourse: { c1: { welcome: 'https://img/c1-w.png', welcomeBack: 'https://img/c1-back.png' } } }
let handlers: Record<string, (data: Record<string, any>) => unknown>
let wxMock: Record<string, any>
let stack: unknown[]
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve()
}
const calls = (action: string) => callAppMock.mock.calls.filter((c: any[]) => c[0] === action).map((c: any[]) => c[1])

async function mount(query: Record<string, string> = {}): Promise<Record<string, any>> {
  vi.resetModules()
  await import('../pages/welcome/welcome')
  const page = Object.create(pageOpts) as Record<string, any>
  page.data = { ...pageOpts.data }
  page.setData = function (patch: Record<string, unknown>) {
    Object.assign(this.data as Record<string, unknown>, patch)
  }
  page.onLoad(query)
  return page
}

beforeEach(() => {
  handlers = {
    getContent: () => ({ ok: true, home: HOME }),
    getPageContent: () => ({ ok: false, error: 'CALL_FAIL' }),
    activateCourse: () => ({ ok: true, state: 'activated', courseId: 'c1' }),
    confirmEnter: () => ({ ok: true }),
    getCourses: () => ({ ok: true, list: [{ id: 'c1', title: '小棉鸭入门' }] }),
  }
  callAppMock.mockReset().mockImplementation(async (action: string, data: Record<string, any>) =>
    handlers[action] ? handlers[action](data) : { ok: false, error: 'UNEXPECTED' }
  )
  stack = [{}]
  wxMock = {
    getWindowInfo: () => ({ statusBarHeight: 20 }),
    showToast: vi.fn(),
    redirectTo: vi.fn(),
    navigateBack: vi.fn(),
    switchTab: vi.fn(),
    reLaunch: vi.fn(),
  }
  ;(globalThis as any).wx = wxMock
  ;(globalThis as any).getCurrentPages = () => stack
})

describe('激活页：兑课', () => {
  it('大白话：扫码带码进来——自动用码兑课；新激活落恭喜屏，背景取本课的图，课程名取到就显示', async () => {
    const page = await mount({ code: ' LDABC123 ' })
    expect(page.data.statusBarHeight).toBe(20)
    await flush()
    expect(calls('activateCourse')).toEqual([{ code: 'LDABC123' }])
    expect(page.data).toMatchObject({ phase: 'result', kind: 'activated', courseId: 'c1', bg: 'https://img/c1-w.png', courseTitle: '小棉鸭入门', busy: false })
  })

  it('大白话：没带码进来停在输入态；空码点激活提示「先输入激活码」；手输的码去空格转大写再兑', async () => {
    const page = await mount()
    await flush()
    expect(page.data.phase).toBe('input')
    page.onActivate()
    expect(wxMock.showToast).toHaveBeenCalledWith({ title: '先输入激活码', icon: 'none' })
    page.onInput({ detail: { value: ' ldabc123 ' } })
    expect(page.data.code).toBe('LDABC123')
    page.onActivate()
    await flush()
    expect(calls('activateCourse')).toEqual([{ code: 'LDABC123' }])
  })

  it('大白话：课程名拉不到、背景配置拉不到——恭喜屏照出，不显课程名、用空背景（不卡住）', async () => {
    handlers.getCourses = () => ({ ok: false, error: 'CALL_FAIL' })
    handlers.getContent = () => ({ ok: false, error: 'CALL_FAIL' })
    const page = await mount({ code: 'LD1' })
    await flush()
    expect(page.data).toMatchObject({ phase: 'result', kind: 'activated', courseTitle: '', bg: '' })
  })

  it('大白话：本人早已进过课——落「欢迎回来」屏，用回访背景，不去取课程名', async () => {
    handlers.activateCourse = () => ({ ok: true, state: 'mine', courseId: 'c1' })
    const page = await mount({ code: 'LD1' })
    await flush()
    expect(page.data).toMatchObject({ kind: 'mine', bg: 'https://img/c1-back.png', courseTitle: '' })
    expect(calls('getCourses')).toEqual([])
  })

  it('大白话：码被别人用了 / 码不对——各落各的屏；点「换一个码」清掉码回输入态', async () => {
    handlers.activateCourse = () => ({ ok: false, error: 'CODE_TAKEN', courseId: 'c1' })
    const taken = await mount({ code: 'LD1' })
    await flush()
    expect(taken.data).toMatchObject({ phase: 'result', kind: 'taken', bg: 'https://img/global.png' })

    handlers.activateCourse = () => ({ ok: false, error: 'INVALID_CODE' })
    const page = await mount({ code: 'LD2' })
    await flush()
    expect(page.data).toMatchObject({ phase: 'result', kind: 'invalid' })
    page.onRetry()
    expect(page.data).toMatchObject({ phase: 'input', code: '', kind: 'invalid', bg: '' })
  })

  it('大白话：网络超时 / 太频繁——不说码不对，给对应文案；点「再试一次」用原码重发', async () => {
    handlers.activateCourse = () => ({ ok: false, error: 'RATE_LIMITED' })
    const page = await mount({ code: 'LD1' })
    await flush()
    expect(page.data).toMatchObject({ kind: 'error', errCopy: ACTIVATION_ERR_COPY.throttled, code: 'LD1' })
    handlers.activateCourse = () => ({ ok: false, error: 'CALL_TIMEOUT' })
    page.onActivate()
    await flush()
    expect(page.data.errCopy).toEqual(ACTIVATION_ERR_COPY.network)
    expect(calls('activateCourse')).toEqual([{ code: 'LD1' }, { code: 'LD1' }])
  })

  it('大白话：兑课还没回来就连点激活——只发一次', async () => {
    let release!: (v: unknown) => void
    handlers.activateCourse = () => new Promise((r) => (release = r))
    const page = await mount()
    page.onInput({ detail: { value: 'LD1' } })
    page.onActivate()
    page.onActivate()
    expect(calls('activateCourse')).toHaveLength(1)
    release({ ok: true, state: 'mine', courseId: 'c1' })
    await flush()
    expect(page.data.busy).toBe(false)
  })

  it('大白话：兑课在途就退出了页面——迟到回包不再改页面', async () => {
    let release!: (v: unknown) => void
    handlers.activateCourse = () => new Promise((r) => (release = r))
    const page = await mount({ code: 'LD1' })
    page.onUnload()
    release({ ok: true, state: 'activated', courseId: 'c1' })
    await flush()
    expect(page.data.phase).toBe('input')
  })

  it('大白话：兑课已回、课程名还在路上就退出了页面——迟到的课程名不再写进页面', async () => {
    let release!: (v: unknown) => void
    handlers.getCourses = () => new Promise((r) => (release = r))
    const page = await mount({ code: 'LD1' })
    await flush()
    expect(page.data.kind).toBe('activated')
    page.onUnload()
    release({ ok: true, list: [{ id: 'c1', title: '小棉鸭入门' }] })
    await flush()
    expect(page.data.courseTitle).toBe('')
  })
})

describe('激活页：进课', () => {
  it('大白话：恭喜屏点「下一步」翻到三件事屏；点「进入课程」确认进课后直达该课目录', async () => {
    const page = await mount({ code: 'LD1' })
    await flush()
    page.onNextWelcome()
    expect(page.data.phase).toBe('w2')
    await page.onEnter()
    expect(calls('confirmEnter')).toEqual([{ code: 'LD1' }])
    expect(wxMock.redirectTo).toHaveBeenCalledWith({ url: '/pages/catalog/catalog?courseId=c1' })
  })

  it('大白话：回包没带课程 id——兜底去「我的课程」，不跳进空目录', async () => {
    handlers.activateCourse = () => ({ ok: true, state: 'mine' })
    const page = await mount({ code: 'LD1' })
    await flush()
    await page.onEnter()
    expect(wxMock.redirectTo).toHaveBeenCalledWith({ url: '/pages/my-courses/my-courses' })
  })

  it('大白话：进课失败——提示稍后再试、按钮恢复；成功前连点只确认一次', async () => {
    handlers.confirmEnter = () => ({ ok: false, error: 'CALL_TIMEOUT' })
    const page = await mount({ code: 'LD1' })
    await flush()
    await page.onEnter()
    expect(wxMock.showToast).toHaveBeenCalledWith({ title: '进课没成功，稍后再试', icon: 'none' })
    expect(page.data.busy).toBe(false)
    expect(wxMock.redirectTo).not.toHaveBeenCalled()

    handlers.confirmEnter = () => ({ ok: true })
    const first = page.onEnter()
    await page.onEnter()
    await first
    expect(calls('confirmEnter')).toHaveLength(2)
    expect(wxMock.redirectTo).toHaveBeenCalledTimes(1)
  })

  it('大白话：进课在途就退出了页面——迟到的成功不再把人拽进目录', async () => {
    let release!: (v: unknown) => void
    handlers.confirmEnter = () => new Promise((r) => (release = r))
    const page = await mount({ code: 'LD1' })
    await flush()
    const pending = page.onEnter()
    page.onUnload()
    release({ ok: true })
    await pending
    expect(wxMock.redirectTo).not.toHaveBeenCalled()
  })
})

describe('激活页：出口与文案', () => {
  it('大白话：自绘返回——有上一页就退回，扫码深链进来（只有一层）就回首页', async () => {
    const page = await mount()
    page.onBack()
    expect(wxMock.switchTab.mock.calls[0][0].url).toBe('/pages/home/home')
    stack = [{}, {}]
    page.onBack()
    expect(wxMock.navigateBack).toHaveBeenCalledTimes(1)
  })

  it('大白话：废码 / 码被占屏点「联系客服」打开客服会话（v5 稿 C2 新增出口）', async () => {
    const page = await mount()
    page.onContact()
    expect(openCsMock).toHaveBeenCalledTimes(1)
  })

  it('大白话：三件事屏点「先逛逛」回首页', async () => {
    const page = await mount()
    page.onGoHome()
    expect(wxMock.switchTab).toHaveBeenCalledWith({ url: '/pages/home/home' })
  })

  it('大白话：后台改过的恭喜屏标题到了就换上；拉不到保持默认，不空屏', async () => {
    const dflt = await mount()
    await flush()
    const defaultTitle = dflt.data.welcome.w1.title
    expect(defaultTitle).toBeTruthy()
    handlers.getPageContent = () => ({ ok: true, content: { w1: { title: '欢迎开课' } } })
    const page = await mount()
    await flush()
    expect(calls('getPageContent')).toContainEqual({ page: 'welcome' })
    expect(page.data.welcome.w1.title).toBe('欢迎开课')
    expect(page.data.welcome.w1.warning).toBe(dflt.data.welcome.w1.warning)
  })

  it('大白话：后台文案还在路上就退出了页面——迟到的文案不再写进页面', async () => {
    const dflt = await mount()
    await flush()
    let release!: (v: unknown) => void
    handlers.getPageContent = () => new Promise((r) => (release = r))
    const page = await mount()
    page.onUnload()
    release({ ok: true, content: { w1: { title: 'X' } } })
    await flush()
    expect(page.data.welcome.w1.title).toBe(dflt.data.welcome.w1.title)
  })
})

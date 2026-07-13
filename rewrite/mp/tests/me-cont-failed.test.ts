// 「我」页继续学习区失败分治（深审 20260712 P2：取数失败伪装空态）：progress/mine/courses 任一
// 失败时空列表与「真没进度/没买课」形状等价，直接喂 continueResolve 会渲染「还没有学习记录」假空态。
// 钉行为：失败 → contFailed 亮（给重试）·不覆盖已有 cont；全成功无课 → 真空态引导保留（contFailed 灭）。
// Page 以全局桩捕获 options（node 环境无小程序运行时·同 cart/catalog 测试 wx 桩家风）。
import { describe, it, expect, vi, beforeEach } from 'vitest'
// wxml 门控断言用（同 home-cards.test.ts 的 ?raw 原文导入范式·类型见 raw-imports.d.ts）
import meWxmlRaw from '../pages/me/me.wxml?raw'

const { loginMock, getMyProgressMock, getMyCoursesMock, getAllCoursesMock, getPageContentMock } = vi.hoisted(() => ({
  loginMock: vi.fn(),
  getMyProgressMock: vi.fn(),
  getMyCoursesMock: vi.fn(),
  getAllCoursesMock: vi.fn(),
  getPageContentMock: vi.fn(),
}))
vi.mock('../api/user', () => ({ login: loginMock, getMyProgress: getMyProgressMock }))
vi.mock('../api/learning', () => ({ getMyCourses: getMyCoursesMock }))
vi.mock('../lib/courses', () => ({ getAllCourses: getAllCoursesMock }))
// 合流补桩（页面内容 CMS 战役后 me.ts 并入 getPageContent('mePage')·本测试只钉 cont 分治，CMS 内容走默认 null）
vi.mock('../lib/pageContent', () => ({ getPageContent: getPageContentMock, __resetForTest: () => {} }))

let pageOpts: Record<string, any> = {}
;(globalThis as any).Page = (o: unknown) => {
  pageOpts = o as Record<string, any>
}

const COURSES = [
  { id: 'c1', title: '小棉鸭', chapters: [{ id: 'ch1', lessons: [{ id: 'l1', name: '起针', segments: [] }] }] },
]

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
  loginMock.mockReset().mockResolvedValue({ ok: true, user: { nickname: '鸭' } })
  getMyProgressMock.mockReset().mockResolvedValue({ ok: true, list: [] })
  getMyCoursesMock.mockReset().mockResolvedValue({ ok: true, list: [] })
  getAllCoursesMock.mockReset().mockResolvedValue(COURSES)
  getPageContentMock.mockReset().mockResolvedValue(null)
})

describe('继续学习区失败分治（失败≠没进度·同 aftersales/order-list loadFailed 范式）', () => {
  it('大白话：进度/我的课/课程目录任一拉取失败 → contFailed 亮起给重试，不渲染「还没有学习记录」假空态', async () => {
    getMyProgressMock.mockResolvedValue({ ok: false, error: 'NETWORK' })
    const p1 = await mountMe()
    await p1.refresh()
    expect(p1.data.contFailed).toBe(true) // 失败态·不是空态
    expect(p1.data.cont).toBeNull()

    getMyCoursesMock.mockResolvedValue({ ok: false, error: 'NETWORK' })
    getMyProgressMock.mockResolvedValue({ ok: true, list: [] })
    const p2 = await mountMe()
    await p2.refresh()
    expect(p2.data.contFailed).toBe(true)

    getMyCoursesMock.mockResolvedValue({ ok: true, list: [] })
    getAllCoursesMock.mockResolvedValue(null) // lib/courses 失败语义＝null
    const p3 = await mountMe()
    await p3.refresh()
    expect(p3.data.contFailed).toBe(true)
  })

  it('大白话：全都成功但真没课没进度 → 仍是正常空态引导（cont 空·contFailed 灭），不误亮失败态', async () => {
    const page = await mountMe()
    await page.refresh()
    expect(page.data.cont).toBeNull()
    expect(page.data.contFailed).toBe(false)
  })

  it('大白话：成功定位到课 → cont 落卡片、contFailed 灭；随后一次刷新失败 → 不清掉已有卡片、不亮失败态', async () => {
    getMyProgressMock.mockResolvedValue({ ok: true, list: [{ courseId: 'c1', last: { lessonId: 'l1' }, updatedAt: 100 }] })
    const page = await mountMe()
    await page.refresh()
    expect(page.data.cont).toMatchObject({ courseId: 'c1', lessonId: 'l1' })
    expect(page.data.contFailed).toBe(false)

    getMyProgressMock.mockResolvedValue({ ok: false, error: 'NETWORK' })
    await page.refresh()
    expect(page.data.cont).toMatchObject({ courseId: 'c1', lessonId: 'l1' }) // 失败不覆盖已有数据（黄金 §八）
    expect(page.data.contFailed).toBe(false) // 还有旧卡可看·不亮失败态
  })
})

// Bug C（2026-07-13 用户反馈「继续学习卡先显示无课程、再变历史记录」·闪空态）：缺「加载中」中间态——
// cont=null 同时表示「尚未加载」和「确认无课」，首帧落到空态；须加 contLoaded，空态只在加载完且真无课才现。
describe('继续学习区加载中态分治（加载中≠没课·消首帧假空态闪烁·根因#8/#14）', () => {
  it('大白话：初始 data 里 contLoaded 为 false（首帧未加载完·不许渲染「还没有学习记录」空态）', async () => {
    const page = await mountMe() // mountMe 返回 refresh 前的初始 data 副本
    expect(page.data.contLoaded).toBe(false)
  })
  it('大白话：refresh 完成后 contLoaded 置 true（成功/失败任一路都置·空态从此才可能出现）', async () => {
    const page = await mountMe()
    await page.refresh()
    expect(page.data.contLoaded).toBe(true)
    // 失败路也须置 true（否则失败时也卡在骨架）
    getMyProgressMock.mockResolvedValue({ ok: false, error: 'NETWORK' })
    const page2 = await mountMe()
    await page2.refresh()
    expect(page2.data.contLoaded).toBe(true)
  })
  it('大白话：me.wxml 的「还没有学习记录」空态不再挂裸 wx:else，须门控在 contLoaded 后，且有加载中骨架兜底', () => {
    const wxml = meWxmlRaw.replace(/<!--[\s\S]*?-->/g, '')
    // 空态文案存在
    expect(wxml).toContain('还没有学习记录')
    // 引入了 contLoaded 门控（空态挂在 contLoaded 分支上·不在数据未回来时渲染）
    expect(wxml).toMatch(/wx:elif="\{\{\s*contLoaded\s*\}\}"/)
    // 有加载中骨架兜底节点（wx:else 落骨架而非空态）
    expect(wxml).toMatch(/ld-me-cont-skeleton/)
  })
})

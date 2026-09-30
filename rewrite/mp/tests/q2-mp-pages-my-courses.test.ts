// 我的课程页行为：三路（已进课/课程目录/进度）拼课卡、失败≠空态（首次失败亮重试·已有课卡刷新失败只轻提示·
// 目录失败同判失败）、进度读不到落「未知」而非 0%、真没课落输码引导、过期回包丢弃、点课/输码跳转。
// 只桩云调用（callApp），api/lib/courses/mapLearning 用真的。Page 桩同 p-mp-order-page.test.ts。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { callAppMock } = vi.hoisted(() => ({ callAppMock: vi.fn() }))
vi.mock('../utils/cloud', () => ({ callApp: callAppMock }))
vi.mock('../lib/haptics', () => ({ tapHaptic: vi.fn() }))

let pageOpts: Record<string, any> = {}
;(globalThis as any).Page = (o: unknown) => {
  pageOpts = o as Record<string, any>
}

const COURSES = [
  {
    id: 'c1',
    title: '小棉鸭',
    chapters: [{ lessons: [{ segments: [{ id: 's1' }, { id: 's2' }, { id: 's3' }, { id: 's4' }] }] }],
  },
]
let handlers: Record<string, () => unknown>
let wxMock: Record<string, any>
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}

async function mount(): Promise<Record<string, any>> {
  vi.resetModules()
  await import('../pages/my-courses/my-courses')
  const page = Object.create(pageOpts) as Record<string, any>
  page.data = { ...pageOpts.data }
  page.setData = function (patch: Record<string, unknown>) {
    Object.assign(this.data as Record<string, unknown>, patch)
  }
  return page
}

beforeEach(() => {
  // 性能批 #4：我的课 + 进度并成一次 getMyLearning（progress:null＝进度读失败）；课程目录仍走 getCourses（会话缓存）
  handlers = {
    getMyLearning: () => ({ ok: true, courses: [{ courseId: 'c1', enteredAt: 0 }], progress: [{ courseId: 'c1', done: { s1: true, s2: true } }] }),
    getCourses: () => ({ ok: true, list: COURSES }),
  }
  callAppMock.mockReset().mockImplementation(async (action: string) => (handlers[action] ? handlers[action]() : { ok: false, error: 'UNEXPECTED' }))
  wxMock = { showToast: vi.fn(), navigateTo: vi.fn() }
  ;(globalThis as any).wx = wxMock
})

describe('我的课程：加载', () => {
  it('大白话：进页先骨架；三路都到——课卡带课程名和「已学 2/4 段 · 50%」', async () => {
    const page = await mount()
    expect(page.data.loading).toBe(true)
    page.onShow()
    await flush()
    expect(page.data).toMatchObject({ loading: false, loadFailed: false })
    expect(page.data.list).toHaveLength(1)
    expect(page.data.list[0]).toMatchObject({ courseId: 'c1', title: '小棉鸭', doneCount: 2, totalSegments: 4, percent: 50, progressUnknown: false })
  })

  it('大白话：真的没进过课——落空态（给输码引导），不亮重试', async () => {
    handlers.getMyLearning = () => ({ ok: true, courses: [], progress: [] })
    const page = await mount()
    await page.reload()
    expect(page.data).toMatchObject({ loading: false, loadFailed: false, list: [] })
  })

  it('大白话：首次加载「我的课」或课程目录拉失败——亮重试，不装成没课、不弹提示；点重试回到加载中并重拉', async () => {
    for (const broken of ['getMyLearning', 'getCourses']) {
      const ok = handlers[broken]
      handlers[broken] = () => ({ ok: false, error: 'CALL_TIMEOUT' })
      const page = await mount()
      await page.reload()
      expect(page.data, broken).toMatchObject({ loading: false, loadFailed: true, list: [] })
      expect(wxMock.showToast).not.toHaveBeenCalled()

      handlers[broken] = ok
      page.onRetryLoad()
      expect(page.data).toMatchObject({ loading: true, loadFailed: false })
      await flush()
      expect(page.data, broken).toMatchObject({ loading: false, loadFailed: false })
      expect(page.data.list).toHaveLength(1)
    }
  })

  it('大白话：已经显示了课卡再刷新失败——课卡不动、不亮重试，只轻提示', async () => {
    const page = await mount()
    await page.reload()
    handlers.getMyLearning = () => ({ ok: false, error: 'CALL_FAIL' })
    await page.reload()
    expect(page.data).toMatchObject({ loading: false, loadFailed: false })
    expect(page.data.list[0].title).toBe('小棉鸭')
    expect(wxMock.showToast).toHaveBeenCalledWith({ title: '刷新失败，请稍后重试', icon: 'none' })
  })

  it('大白话：只有进度没读到——课卡照常出，进度标「读不到」而不是谎报 0%', async () => {
    handlers.getMyLearning = () => ({ ok: true, courses: [{ courseId: 'c1', enteredAt: 0 }], progress: null })
    const page = await mount()
    await page.reload()
    expect(page.data.loadFailed).toBe(false)
    expect(page.data.list[0]).toMatchObject({ title: '小棉鸭', totalSegments: 4, progressUnknown: true })
  })

  it('大白话：两次刷新并发、先发的后回——旧回包（超时失败）丢掉，不把新结果盖成失败', async () => {
    let releaseOld!: (v: unknown) => void
    handlers.getMyLearning = () => new Promise((r) => (releaseOld = r))
    const page = await mount()
    const old = page.reload()
    handlers.getMyLearning = () => ({ ok: true, courses: [{ courseId: 'c1' }], progress: [] })
    await page.reload()
    releaseOld({ ok: false, error: 'CALL_TIMEOUT' })
    await old
    expect(page.data).toMatchObject({ loading: false, loadFailed: false })
    expect(page.data.list).toHaveLength(1)
    expect(wxMock.showToast).not.toHaveBeenCalled()
  })
})

describe('我的课程：跳转', () => {
  it('大白话：点课卡进该课目录（不再有应用内激活入口：老板拍板只用微信扫实体卡）', async () => {
    const page = await mount()
    page.onTapCourse({ currentTarget: { dataset: { id: 'c1' } } })
    expect(wxMock.navigateTo.mock.calls.map((c: any[]) => c[0].url)).toEqual(['/pages/catalog/catalog?courseId=c1'])
  })
})

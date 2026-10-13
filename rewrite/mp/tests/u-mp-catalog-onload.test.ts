// 课程目录页 onLoad：缺 courseId 直接落 missing、不发请求；有 courseId 保持 loading 并并行拉 hero 背景（失败回退链）。
// Page 桩同 me-cont-failed.test.ts。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { bgFor } from '../lib/mapLearning'

const { getContentMock } = vi.hoisted(() => ({ getContentMock: vi.fn() }))
vi.mock('../api/catalog', () => ({ getContent: getContentMock }))
vi.mock('../lib/pageContent', () => ({ getPageContent: vi.fn().mockResolvedValue(null), getHomeContent: () => getContentMock() })) // 缓存层本身见 home-content-cache.test
vi.mock('../lib/courses', () => ({ getCourseByIdDetailed: vi.fn() }))
vi.mock('../api/user', () => ({ getMyProgress: vi.fn() }))
vi.mock('../lib/playbackCache', () => ({ playbackCache: { prefetch: vi.fn() } }))

let pageOpts: Record<string, any> = {}
;(globalThis as any).Page = (o: unknown) => {
  pageOpts = o as Record<string, any>
}

async function mount(): Promise<Record<string, any>> {
  vi.resetModules()
  await import('../pages/catalog/catalog')
  const page = Object.create(pageOpts) as Record<string, any>
  page.data = { ...pageOpts.data }
  page.setData = function (patch: Record<string, unknown>) {
    Object.assign(this.data as Record<string, unknown>, patch)
  }
  return page
}

const flush = () => new Promise((r) => setTimeout(r, 0))
const HOME = { courseHero: { c1: { activated: 'https://img/c1.jpg' } } }

beforeEach(() => {
  ;(globalThis as any).wx = { getWindowInfo: () => ({ statusBarHeight: 24 }) }
  getContentMock.mockReset()
})

describe('课程目录 onLoad', () => {
  it('大白话：缺 courseId → 落「没找到」态，不拉 hero', async () => {
    const page = await mount()
    page.onLoad({})
    expect(page.data).toMatchObject({ statusBarHeight: 24, courseId: '', state: 'missing' })
    expect(getContentMock).not.toHaveBeenCalled()
  })

  it('大白话：有 courseId → 保持加载态，hero 背景按首页内容走回退链', async () => {
    getContentMock.mockResolvedValue({ ok: true, home: HOME })
    const page = await mount()
    page.onLoad({ courseId: 'c1' })
    expect(page.data).toMatchObject({ statusBarHeight: 24, courseId: 'c1', state: 'loading' })
    expect(getContentMock).toHaveBeenCalledTimes(1)
    await flush()
    expect(page.home).toBe(HOME)
    expect(page.data.bg).toBe(bgFor(HOME, 'c1', 'activated'))
  })

  it('大白话：章默认只展开当前课时所在章；点过的章记住，从播放页回来重拉目录也不被冲掉', async () => {
    getContentMock.mockResolvedValue({ ok: false })
    const page = await mount()
    const { getCourseByIdDetailed } = await import('../lib/courses')
    const { getMyProgress } = await import('../api/user')
    const seg = (id: string) => ({ id, hasVideo: true })
    vi.mocked(getCourseByIdDetailed).mockResolvedValue({
      failed: false,
      course: { id: 'c1', chapters: [{ title: '身体', lessons: [{ id: 'l1', segments: [seg('s1')] }] }, { title: '帽子', lessons: [{ id: 'l2', segments: [seg('s2')] }] }] },
    } as never)
    vi.mocked(getMyProgress).mockResolvedValue({ ok: true, list: [{ courseId: 'c1', done: { s1: true }, last: { lessonId: 'l2', segmentId: 's2' }, updatedAt: 1 }] } as never)
    page.onLoad({ courseId: 'c1' })
    await page.onShow()
    expect(page.data.chapters.map((c: { open: boolean }) => c.open)).toEqual([false, true])
    expect(page.data.chapters[1].lessons[0].segs).toEqual(['current'])
    page.onToggleChapter({ currentTarget: { dataset: { i: 0 } } })
    await page.onShow()
    expect(page.data.chapters.map((c: { open: boolean }) => c.open)).toEqual([true, true])
  })

  it('大白话：hero 内容拉取失败 → 不阻塞，home 置空走回退链', async () => {
    getContentMock.mockResolvedValue({ ok: false, error: 'NETWORK' })
    const page = await mount()
    page.onLoad({ courseId: 'c1' })
    await flush()
    expect(page.home).toBeNull()
    expect(page.data.bg).toBe(bgFor(null, 'c1', 'activated'))
    expect(page.data.state).toBe('loading')
  })
})

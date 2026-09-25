// 播放页行为：切段四个落点的 canPrev/canNext 与下一段预热、媒体错误重试预算、返回键逐层收口、
// 松手 seek 的 play 时机、进页并行暖取期望段地址。取址缓存用真实 lib/playbackCache，只桩云端 getPlaybackUrl。
// Page 桩同 me-cont-failed.test.ts。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { urlMock, trackMock, courseMock, goBackMock } = vi.hoisted(() => ({
  urlMock: vi.fn(),
  trackMock: vi.fn(),
  courseMock: vi.fn(),
  goBackMock: vi.fn(),
}))
vi.mock('../api/learning', () => ({ trackEvent: trackMock, getHelpVideos: vi.fn(), getPublicFaq: vi.fn(), getPlaybackUrl: urlMock }))
vi.mock('../lib/courses', () => ({ getCourseByIdDetailed: courseMock }))
vi.mock('../lib/pageContent', () => ({ getPageContent: vi.fn().mockResolvedValue(null) }))
vi.mock('../utils/customerService', () => ({ openCustomerService: vi.fn() }))
vi.mock('../lib/nav', () => ({ goBackOrHome: goBackMock }))

let pageOpts: Record<string, any> = {}
;(globalThis as any).Page = (o: unknown) => {
  pageOpts = o as Record<string, any>
}

const COURSE = {
  id: 'c1',
  title: '小鸭课',
  chapters: [
    {
      id: 'ch1',
      lessons: [
        { id: 'l1', name: '起针', segments: [{ id: 's1', hasVideo: true }, { id: 's2', hasVideo: true }] },
        { id: 'l2', name: '收尾', segments: [{ id: 's3', hasVideo: true }] },
      ],
    },
  ],
}

let video: { seek: ReturnType<typeof vi.fn>; play: ReturnType<typeof vi.fn>; calls: string[] }
let store: Record<string, unknown>

async function mount(): Promise<Record<string, any>> {
  vi.resetModules()
  await import('../pages/player/player')
  const page = Object.create(pageOpts) as Record<string, any>
  page.data = { ...pageOpts.data }
  page.setData = function (patch: Record<string, unknown>, cb?: () => void) {
    Object.assign(this.data as Record<string, unknown>, patch)
    if (cb) cb()
  }
  page.measureSeekRect = vi.fn()
  page.courseId = 'c1'
  page.course = COURSE
  return page
}

const flush = () => new Promise((r) => setTimeout(r, 0))
const seg = (id: string) => ({ chapterTitle: '', lessonId: id === 's3' ? 'l2' : 'l1', lessonName: '', segmentId: id, segName: '', hasVideo: true, marks: [] })
const fetchedSegs = () => urlMock.mock.calls.map((c) => c[1])

beforeEach(() => {
  video = { seek: vi.fn(() => video.calls.push('seek')), play: vi.fn(() => video.calls.push('play')), calls: [] }
  store = {}
  ;(globalThis as any).wx = {
    createVideoContext: () => video,
    getWindowInfo: () => ({ statusBarHeight: 20, windowWidth: 375, windowHeight: 700 }),
    getMenuButtonBoundingClientRect: () => ({ bottom: 60 }),
    getStorageSync: (k: string) => store[k],
    setStorageSync: (k: string, v: unknown) => {
      store[k] = v
    },
    getDeviceInfo: () => ({ platform: 'android' }),
    showToast: vi.fn(),
  }
  urlMock.mockReset().mockImplementation(async (_c: string, s: string) => ({ ok: true, url: 'https://v/' + s }))
  trackMock.mockReset()
  courseMock.mockReset().mockResolvedValue({ failed: false, course: COURSE })
  goBackMock.mockReset()
})

describe('切段落点：上/下一段按钮态 + 下一段预热', () => {
  it('大白话：取址成功 → 播放态，首段不能上一段、能下一段，并预热下一段地址', async () => {
    const page = await mount()
    await page.playSegment(seg('s1'), 'enter')
    await flush()
    expect(page.data).toMatchObject({ state: 'playing', src: 'https://v/s1', canPrev: false, canNext: true })
    expect(fetchedSegs()).toEqual(['s1', 's2'])
  })

  it('大白话：缓存命中（已预热）→ 直落播放，中间段上下都能点，再预热下一段；末段不能下一段、不预热', async () => {
    const page = await mount()
    await page.playSegment(seg('s1'), 'enter')
    await flush()
    await page.playSegment(seg('s2'), 'seg') // s2 已预热：peek 命中
    await flush()
    expect(page.data).toMatchObject({ state: 'playing', src: 'https://v/s2', canPrev: true, canNext: true })
    expect(fetchedSegs()).toEqual(['s1', 's2', 's3'])
    await page.playSegment(seg('s3'), 'seg')
    await flush()
    expect(page.data).toMatchObject({ state: 'playing', src: 'https://v/s3', canPrev: true, canNext: false })
    expect(fetchedSegs()).toEqual(['s1', 's2', 's3'])
  })

  it('大白话：取址失败 → 播放失败态，按钮态照算（能跳下一段），上报 video_error', async () => {
    urlMock.mockResolvedValue({ ok: false, error: 'TIMEOUT' })
    const page = await mount()
    await page.playSegment(seg('s2'), 'enter')
    expect(page.data).toMatchObject({ state: 'error', canPrev: true, canNext: true })
    expect(trackMock).toHaveBeenCalledWith('video_error', 'player', 's2', { courseId: 'c1', phase: 'fetch' })
  })

  it('大白话：素材未剪（url 空）→ 空态、src 清空，按钮态照算', async () => {
    urlMock.mockResolvedValue({ ok: true, url: '' })
    const page = await mount()
    await page.playSegment(seg('s1'), 'enter')
    expect(page.data).toMatchObject({ state: 'empty', src: '', canPrev: false, canNext: true })
  })

  it('大白话：未授权 → denied 导流激活', async () => {
    urlMock.mockResolvedValue({ ok: false, error: 'NOT_ENTITLED' })
    const page = await mount()
    await page.playSegment(seg('s1'), 'enter')
    expect(page.data.state).toBe('denied')
  })
})

describe('媒体错误自动重试预算', () => {
  const fail = async (page: Record<string, any>) => {
    page.onVideoError()
    await flush()
  }
  it('大白话：同段连错——前两次失效重取、第三次落播放失败态并上报；手动重试和换段都重置预算', async () => {
    const page = await mount()
    await page.playSegment(seg('s1'), 'enter')
    await flush()
    await fail(page)
    await fail(page)
    expect(page.data.state).toBe('playing')
    await fail(page)
    expect(page.data.state).toBe('error')
    expect(trackMock).toHaveBeenCalledWith('video_error', 'player', 's1', { courseId: 'c1', phase: 'media', retries: 2 })

    page.onRetryError()
    await flush()
    expect(page.data.state).toBe('playing')
    await fail(page)
    await fail(page)
    expect(page.data.state).toBe('playing')

    await page.playSegment(seg('s2'), 'seg')
    await flush()
    await fail(page)
    await fail(page)
    expect(page.data.state).toBe('playing')
    await fail(page)
    expect(page.data.state).toBe('error')
  })

  it('大白话：不在播放态时的错误（换段时旧视频补发）不吃预算', async () => {
    const page = await mount()
    page.data.state = 'loading'
    page.data.current = seg('s1')
    page.onVideoError()
    await flush()
    expect(urlMock).not.toHaveBeenCalled()
  })
})

describe('返回键：求助面板逐层收口，关了才走二次确认', () => {
  it('大白话：内嵌播放 → 回列表；列表（视频/问答）→ 菜单；菜单 → 关面板', async () => {
    const page = await mount()
    Object.assign(page.data, { helpPanel: 'videos', helpSrc: 'https://h', helpSegName: '起针' })
    page.onBack()
    expect(page.data).toMatchObject({ helpPanel: 'videos', helpSrc: '', helpSegName: '' })
    page.onBack()
    expect(page.data.helpPanel).toBe('menu')
    page.data.helpPanel = 'faq'
    page.onBack()
    expect(page.data.helpPanel).toBe('menu')
    page.onBack()
    expect(page.data.helpPanel).toBe('')
    expect(goBackMock).not.toHaveBeenCalled()
    expect((globalThis as any).wx.showToast).not.toHaveBeenCalled()
  })

  it('大白话：面板关着——第一按提示、窗口内第二按首次弹加桌引导；引导里点退出才真退', async () => {
    const page = await mount()
    page.onBack()
    expect((globalThis as any).wx.showToast).toHaveBeenCalledTimes(1)
    page.onBack()
    expect(page.data.deskGuide).toBe(true)
    expect(goBackMock).not.toHaveBeenCalled()
    page.onDeskGuideExit()
    expect(page.data.deskGuide).toBe(false)
    expect(goBackMock).toHaveBeenCalledTimes(1)
  })

  it('大白话：引导已展示过——窗口内第二按直接真退', async () => {
    store['ld_player_desk_guide_shown'] = 1
    const page = await mount()
    page.onBack()
    page.onBack()
    expect(goBackMock).toHaveBeenCalledTimes(1)
    expect(page.data.deskGuide).toBe(false)
  })
})

describe('松手 seek', () => {
  const setup = async (over: Record<string, unknown>) => {
    const page = await mount()
    Object.assign(page.data, { current: seg('s1'), seeking: true, durSec: 200, paused: false, segDone: false, snapName: '节点' }, over)
    return page
  }
  it('大白话：播放中松手 → 先 seek 再 play，收口拖动态并同步落位秒', async () => {
    const page = await setup({})
    page.onSeekCommit({ sec: 50 })
    expect(video.calls).toEqual(['seek', 'play'])
    expect(video.seek).toHaveBeenCalledWith(50)
    expect(page.data).toMatchObject({ seeking: false, snapName: '', curSec: 50, curClock: '0:50', seekPct: 25 })
  })
  it('大白话：用户暂停中松手 → 只 seek 不 play', async () => {
    const page = await setup({ paused: true })
    page.onSeekCommit({ sec: 50 })
    expect(video.calls).toEqual(['seek'])
    expect(page.data).toMatchObject({ seeking: false, curSec: 50, seekPct: 25 })
  })
  it('大白话：播完态（paused）松手 → seek 后恢复播放并退出完成态', async () => {
    const page = await setup({ paused: true, segDone: true })
    page.onSeekCommit({ detail: { sec: 100 } })
    expect(video.calls).toEqual(['seek', 'play'])
    expect(page.data).toMatchObject({ segDone: false, seeking: false, snapName: '', curSec: 100, curClock: '1:40', seekPct: 50 })
  })
  it('大白话：非拖动态的杂散提交丢弃', async () => {
    const page = await setup({ seeking: false })
    page.onSeekCommit({ sec: 50 })
    expect(video.calls).toEqual([])
  })
})

describe('进页：目录与期望段地址并行', () => {
  it('大白话：带期望段进页 → 目录回来前就已在取该段地址，起播命中缓存不再重取', async () => {
    let release!: (v: unknown) => void
    courseMock.mockReturnValue(new Promise((r) => (release = r)))
    const page = await mount()
    page._wantSeg = 's2'
    const done = page.initCourse()
    await flush()
    expect(fetchedSegs()).toEqual(['s2'])
    release({ failed: false, course: COURSE })
    await done
    await flush()
    expect(page.data).toMatchObject({ state: 'playing', src: 'https://v/s2' })
    expect(fetchedSegs()).toEqual(['s2', 's3'])
  })
  it('大白话：期望段暖取被拒（未授权）不打断进页；起播时再取一次，落 denied', async () => {
    urlMock.mockResolvedValue({ ok: false, error: 'NOT_ENTITLED' })
    const page = await mount()
    page._wantSeg = 's1'
    await page.initCourse()
    expect(page.data.state).toBe('denied')
    expect(fetchedSegs()).toEqual(['s1', 's1'])
  })
  it('大白话：无期望段 → 不暖取，直接从第一段起播', async () => {
    const page = await mount()
    const done = page.initCourse()
    expect(fetchedSegs()).toEqual([])
    await done
    await flush()
    expect(page.data).toMatchObject({ state: 'playing', src: 'https://v/s1' })
  })
})

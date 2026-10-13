// 播放页行为：切段四个落点的 canPrev/canNext 与下一段预热、媒体错误重试预算、返回键逐层收口、
// 松手 seek 的 play 时机、进页并行暖取期望段地址。取址缓存用真实 lib/playbackCache，只桩云端 getPlaybackUrl。
// Page 桩同 me-cont-failed.test.ts。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import playerWxml from '../pages/player/player.wxml?raw'
import playerWxss from '../pages/player/player.wxss?raw'

const { urlMock, trackMock, courseMock, goBackMock, faqMock } = vi.hoisted(() => ({
  urlMock: vi.fn(),
  trackMock: vi.fn(),
  courseMock: vi.fn(),
  goBackMock: vi.fn(),
  faqMock: vi.fn(),
}))
vi.mock('../api/learning', () => ({ trackEvent: trackMock, getHelpVideos: vi.fn(), getPublicFaq: faqMock, getPlaybackUrl: urlMock }))
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
const seg = (id: string) => ({ lessonId: id === 's3' ? 'l2' : 'l1', lessonName: '', segmentId: id, segName: '', hasVideo: true, marks: [] })
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
    navigateBack: vi.fn(),
    redirectTo: vi.fn(),
  }
  urlMock.mockReset().mockImplementation(async (_c: string, s: string) => ({ ok: true, url: 'https://v/' + s }))
  trackMock.mockReset()
  courseMock.mockReset().mockResolvedValue({ failed: false, course: COURSE })
  goBackMock.mockReset()
  faqMock.mockReset()
})

describe('首帧前不黑屏：起播前转圈、iOS 拦自动播放换播放键（UI 审查 2026-09-29·老板选「只转圈不加字」）', () => {
  it('大白话：地址到了还没真开播——started 为假（显示转圈）；真开播置真；换段重新复位', async () => {
    const page = await mount()
    await page.playSegment(seg('s1'), 'enter')
    await flush()
    expect(page.data.started).toBe(false)
    page.onVideoPlay()
    expect(page.data.started).toBe(true)
    await page.playSegment(seg('s2'), 'seg')
    await flush()
    expect(page.data).toMatchObject({ started: false, blocked: false })
  })

  it('大白话：视频信息到了 1 秒还没开播（iOS 拦了自动播放）——转圈换成播放键；正常起播则不换', async () => {
    const page = await mount()
    await page.playSegment(seg('s1'), 'enter')
    await flush()
    vi.useFakeTimers()
    try {
      page.onVideoMeta()
      vi.advanceTimersByTime(999)
      expect(page.data.blocked).toBe(false)
      vi.advanceTimersByTime(1)
      expect(page.data.blocked).toBe(true)
      page.onVideoPlay() // 用户点了播放键真起播：播放键撤掉
      expect(page.data.blocked).toBe(false)
      page.onVideoMeta() // 已起播：再来元数据也不再判拦截
      vi.advanceTimersByTime(1000)
      expect(page.data.blocked).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('大白话：画面层——起播前只有转圈（不加字）；「单击画面」提示条与缓冲角标都等真开播后才出；被拦时显示播放键', () => {
    const live = playerWxml.replace(/<!--[\s\S]*?-->/g, '')
    const zone = live.match(/<view wx:if="\{\{src && !segDone\}\}" class="lp-tapzone"[\s\S]*?\n {6}<\/view>/)?.[0] ?? ''
    expect(zone).toMatch(/<view wx:if="\{\{!started && !blocked\}\}" class="lp-first-loader"><px-anim name="loader" size="2" dark \/><\/view>/)
    expect(zone).toMatch(/wx:if="\{\{state === 'playing' && started && !hintDismissed\}\}" class="t-sys lp-tap-hint[ "]/)
    expect(zone).toMatch(/wx:if="\{\{paused \|\| blocked\}\}" class="lp-pause-badge[ "]/)
    expect(zone).toMatch(/wx:if="\{\{buffering && !paused && started\}\}"/)
  })
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

describe('返回键：求助面板逐层收口，关了就回本课目录（v6 Lite·老板 2026-10-13）', () => {
  const stack = (...pages: [string, string][]) => {
    ;(globalThis as any).getCurrentPages = () => pages.map(([route, courseId]) => ({ route, options: { courseId } }))
  }
  const CATALOG = 'pages/catalog/catalog'
  const PLAYER = 'pages/player/player'

  it('大白话：内嵌播放 → 回列表；列表（视频/问答）→ 菜单；菜单 → 关面板；这几步都不离开播放页', async () => {
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
    expect((globalThis as any).wx.navigateBack).not.toHaveBeenCalled()
    expect((globalThis as any).wx.redirectTo).not.toHaveBeenCalled()
  })

  it('大白话：第一次离开——先弹加桌引导、不走；引导里点「知道了」回目录，不再要求按第二次', async () => {
    stack([CATALOG, 'c1'], [PLAYER, 'c1'])
    const page = await mount()
    page.onBack()
    expect(page.data.deskGuide).toBe(true)
    expect((globalThis as any).wx.navigateBack).not.toHaveBeenCalled()
    page.onDeskGuideExit()
    expect(page.data.deskGuide).toBe(false)
    expect((globalThis as any).wx.navigateBack).toHaveBeenCalledWith({ delta: 1 })
    expect((globalThis as any).wx.showToast).not.toHaveBeenCalled()
  })

  it('大白话：引导看过——一按就回本课目录：栈里有就退回去（别的课的目录不算），没有就把播放页换成本课目录', async () => {
    store['ld_player_desk_guide_shown'] = 1
    const page = await mount()
    stack([CATALOG, 'c1'], [CATALOG, 'c2'], [PLAYER, 'c1'])
    page.onBack()
    expect((globalThis as any).wx.navigateBack).toHaveBeenCalledWith({ delta: 2 })
    stack(['pages/me/me', ''], [PLAYER, 'c1'])
    page.onBack()
    expect((globalThis as any).wx.redirectTo).toHaveBeenCalledWith({ url: '/pages/catalog/catalog?courseId=c1' })
    expect(page.data.deskGuide).toBe(false)
  })

  it('大白话：坏链接连课程 id 都没有——退回上一页兜底（不跳一个找不到课的目录）', async () => {
    store['ld_player_desk_guide_shown'] = 1
    const page = await mount()
    page.courseId = ''
    page.onBack()
    expect(goBackMock).toHaveBeenCalledTimes(1)
    expect((globalThis as any).wx.redirectTo).not.toHaveBeenCalled()
  })
})

describe('手势返回（隐形 page-container·老板 2026-10-13）：第一次提醒，2 秒内再来一次回本课目录', () => {
  const stack = (...pages: [string, string][]) => {
    ;(globalThis as any).getCurrentPages = () => pages.map(([route, courseId]) => ({ route, options: { courseId } }))
  }
  const w = () => (globalThis as any).wx
  const HINT = { title: '再返回一次回目录', icon: 'none', duration: 2000, mask: undefined }

  it('大白话：进页就武装；第一次手势只提醒不走，隔一拍重新武装；2 秒内再来一次 → 回本课目录，走前先撤拦截、走后不再武装', async () => {
    store['ld_player_desk_guide_shown'] = 1
    stack(['pages/catalog/catalog', 'c1'], ['pages/player/player', 'c1'])
    const page = await mount()
    let guardAtLeave: unknown = 'unset'
    w().navigateBack = vi.fn(() => (guardAtLeave = page.data.backGuard))
    page.onShow()
    expect(page.data.backGuard).toBe(true)
    vi.useFakeTimers()
    try {
      page.onGestureBack()
      expect(w().showToast).toHaveBeenCalledWith(HINT)
      expect(w().navigateBack).not.toHaveBeenCalled()
      expect(page.data.backGuard).toBe(false)
      vi.advanceTimersByTime(100)
      expect(page.data.backGuard).toBe(true)
      vi.advanceTimersByTime(1500)
      page.onGestureBack()
      expect(w().navigateBack).toHaveBeenCalledWith({ delta: 1 })
      expect(guardAtLeave).toBe(false)
      vi.advanceTimersByTime(1000)
      expect(page.data.backGuard).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('大白话：两次手势隔了 2 秒以上——第二次仍然只是提醒（误触保护恢复）', async () => {
    store['ld_player_desk_guide_shown'] = 1
    stack(['pages/catalog/catalog', 'c1'], ['pages/player/player', 'c1'])
    const page = await mount()
    vi.useFakeTimers()
    try {
      page.onGestureBack()
      vi.advanceTimersByTime(2100)
      page.onGestureBack()
      expect(w().showToast).toHaveBeenCalledTimes(2)
      expect(w().navigateBack).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('大白话：求助面板开着——手势只收一层、不提醒；加桌引导开着——手势关掉引导、留在播放页', async () => {
    const page = await mount()
    vi.useFakeTimers()
    try {
      Object.assign(page.data, { helpPanel: 'faq' })
      page.onGestureBack()
      expect(page.data.helpPanel).toBe('menu')
      Object.assign(page.data, { helpPanel: '', deskGuide: true })
      page.onGestureBack()
      expect(page.data.deskGuide).toBe(false)
      expect(w().showToast).not.toHaveBeenCalled()
      expect(w().navigateBack).not.toHaveBeenCalled()
      vi.advanceTimersByTime(100)
      expect(page.data.backGuard).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('大白话：点左上角返回键也先撤拦截再导航（武装着的 page-container 会把自己的 navigateBack 也拦下）；wxml 挂了拦截容器', async () => {
    store['ld_player_desk_guide_shown'] = 1
    stack(['pages/catalog/catalog', 'c1'], ['pages/player/player', 'c1'])
    const page = await mount()
    let guardAtLeave: unknown = 'unset'
    w().navigateBack = vi.fn(() => (guardAtLeave = page.data.backGuard))
    page.onShow()
    page.onBack()
    expect(guardAtLeave).toBe(false)
    expect(playerWxml).toContain('<page-container show="{{backGuard}}" overlay="{{false}}" duration="{{0}}" bindbeforeleave="onGestureBack" />')
  })
})

describe('画面内 seek 条与原生视频手势（老板安卓真机 2026-10-13：拖动松手又回原位）', () => {
  it('大白话：自绘 seek 条压在视频画面上——主视频必须关掉微信自带的「手势调进度」，否则横着拖时原生播放器也跟着跳、把我们的落点盖回去', () => {
    const video = playerWxml.replace(/<!--[\s\S]*?-->/g, '').match(/<video[^>]*id="lp-video"[^>]*>/)?.[0] ?? ''
    expect(video).toContain('id="lp-video"')
    expect(video).toContain('enable-progress-gesture="{{false}}"')
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
    page.onSeekCommit({ sec: 100 })
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

describe('续播秒：只在真把地址交给视频时才消费，失败留给重试', () => {
  const wantS1 = async () => {
    const page = await mount()
    page._wantSeg = 's1'
    page._wantAt = 42
    return page
  }

  it('大白话：地址已预热（缓存命中）→ 直接带续播秒起播，并消费掉', async () => {
    const page = await wantS1()
    const { playbackCache } = await import('../lib/playbackCache')
    await playbackCache.prefetch('c1', 's1')
    await page.playSegment(seg('s1'), 'enter')
    expect(page.data).toMatchObject({ state: 'playing', src: 'https://v/s1', initialTime: 42 })
    expect(page._wantAt).toBe(0)
  })

  it('大白话：现取地址——加载骨架时 initialTime 是 0（视频还没挂），取到后才带 42 起播并消费', async () => {
    let release!: (v: unknown) => void
    urlMock.mockReturnValueOnce(new Promise((r) => (release = r)))
    const page = await wantS1()
    const p = page.playSegment(seg('s1'), 'enter')
    expect(page.data).toMatchObject({ state: 'loading', src: '', initialTime: 0 })
    expect(page._wantAt).toBe(42)
    release({ ok: true, url: 'https://v/s1' })
    await p
    expect(page.data).toMatchObject({ state: 'playing', initialTime: 42 })
    expect(page._wantAt).toBe(0)
  })

  it('大白话：未授权 / 取址失败 / 素材未剪都不消费续播秒，之后重试成功仍续到 42 秒', async () => {
    for (const r of [{ ok: false, error: 'NOT_ENTITLED' }, { ok: false, error: 'TIMEOUT' }, { ok: true, url: '' }]) {
      urlMock.mockResolvedValueOnce(r)
      const page = await wantS1()
      await page.playSegment(seg('s1'), 'enter')
      expect(['denied', 'error', 'empty']).toContain(page.data.state)
      expect(page._wantAt, JSON.stringify(r)).toBe(42)
      await page.playSegment(seg('s1'), 'retry')
      expect(page.data).toMatchObject({ state: 'playing', initialTime: 42 })
      expect(page._wantAt).toBe(0)
    }
  })

  it('大白话：换到别的段——不带续播秒，也不动留给期望段的秒', async () => {
    const page = await wantS1()
    await page.playSegment(seg('s2'), 'seg')
    expect(page.data).toMatchObject({ state: 'playing', initialTime: 0 })
    expect(page._wantAt).toBe(42)
  })
})

describe('求助面板常见问题：失败≠没有', () => {
  it('大白话：后台没配 CMS 问答时拉知识库——失败落 fail、真没有落 empty、有就 ok', async () => {
    const cases: Array<[unknown, string]> = [
      [{ ok: false, error: 'CALL_FAIL' }, 'fail'],
      [{ ok: true, items: [] }, 'empty'],
      [{ ok: true, items: [{ key: 'k', title: '要多久？', content: '3 小时' }] }, 'ok'],
    ]
    for (const [r, state] of cases) {
      faqMock.mockResolvedValueOnce(r)
      const page = await mount()
      page.data.help = { ...page.data.help, faq: [] }
      page.onHelpFaq()
      expect(page.data).toMatchObject({ helpPanel: 'faq', helpFaqState: 'loading' })
      await flush()
      expect(page.data.helpFaqState).toBe(state)
    }
  })

  it('大白话：后台已配 CMS 问答——直接进问答层，不写加载中、不再拉知识库', async () => {
    const page = await mount()
    page.data.help = { ...page.data.help, faq: [{ q: '要多久？', a: '3 小时' }] }
    const patches: Record<string, unknown>[] = []
    const set = page.setData
    page.setData = function (patch: Record<string, unknown>, cb?: () => void) {
      patches.push(patch)
      set.call(this, patch, cb)
    }
    page.onHelpFaq()
    expect(page.data.helpPanel).toBe('faq')
    expect(patches.some((p) => p.helpFaqState === 'loading')).toBe(false)
    expect(faqMock).not.toHaveBeenCalled()
  })
})

describe('进页与拖动几何', () => {
  it('大白话：全段列表只本地用来挑开播段，不塞进页面数据', async () => {
    const page = await mount()
    expect(page.data).not.toHaveProperty('segments')
    await page.initCourse()
    await flush()
    expect(page.data.state).toBe('playing')
    expect(page.data).not.toHaveProperty('segments')
  })

  it('大白话：下发给 seek.wxs 的几何带预览防出屏边距（64rpx 按屏宽换成 px）；没量到轨道就不下发', async () => {
    const page = await mount()
    page.windowWidthPx = 375
    expect(page.buildSeekCfg(100, [])).toBeNull()
    page._seekRect = { left: 0, width: 300 }
    expect(page.buildSeekCfg(100, [{ at: 10, name: 'A' }])).toEqual({ rect: { left: 0, width: 300 }, durSec: 100, marks: [{ at: 10, name: 'A' }], edgePx: 32, snapSec: 3 })
  })
})

describe('上一段（v6 Lite）：播过 3 秒回本段开头，否则退上一段', () => {
  it('大白话：本段播到第 4 秒点上一段 → 原地从头重播，不换段；第 3 秒内点 → 退到上一段（跨课时）', async () => {
    const page = await mount()
    await page.playSegment(seg('s3'), 'enter')
    await flush()
    page.data.curSec = 4
    video.calls = []
    page.onPrev()
    expect(video.calls).toEqual(['seek', 'play'])
    expect(page.data.current.segmentId).toBe('s3')
    page.data.curSec = 3
    page.onPrev()
    await flush()
    expect(page.data.current.segmentId).toBe('s2')
  })

  it('大白话：全课第一段没有上一段——上一段键不显示（只藏不删、位置留着，中间求助键不跳位）；别的课时第一段能退回上一课时，照常显示（老板 2026-10-13）', async () => {
    const page = await mount()
    await page.playSegment(seg('s1'), 'enter')
    await flush()
    expect(page.data.canPrev).toBe(false)
    await page.playSegment(seg('s3'), 'seg') // 第 2 课时第 1 段：上一段＝第 1 课时末段
    await flush()
    expect(page.data.canPrev).toBe(true)
    expect(playerWxml.replace(/<!--[\s\S]*?-->/g, '')).toContain(`class="k k-48 k-sq k-dk lp-prev {{canPrev ? '' : 'lp-hide'}}"`)
    expect(playerWxss).toMatch(/\.lp-hide \{\s*visibility: hidden;/)
  })
})

describe('段末（v6 Lite）：重播横条 + 下一段反相；全课末段点下一段进结业页', () => {
  it('大白话：段末停住——画面底部出重播横条、下一段键反相；点重播从头再放并退出段末', async () => {
    const page = await mount()
    await page.playSegment(seg('s1'), 'enter')
    await flush()
    page.onEnded()
    expect(page.data).toMatchObject({ segDone: true, paused: true })
    expect(playerWxml).toMatch(/<view wx:if="\{\{segDone\}\}" class="k-inv lp-replay"[^>]*bind:tap="onReplay"/)
    expect(playerWxml).toContain("lp-next {{segDone ? 'k-inv' : (canNext ? 'k-dk' : 'lp-key-off')}}")
    video.calls = []
    page.onReplay()
    expect(video.calls).toEqual(['seek', 'play'])
    expect(page.data.segDone).toBe(false)
  })

  it('大白话：课时末段播完点下一段 → 进下一课时第一段（不另出「学完一节」页）', async () => {
    const page = await mount()
    await page.playSegment(seg('s2'), 'enter')
    await flush()
    page.onEnded()
    page.onNext()
    await flush()
    expect(page.data).toMatchObject({ state: 'playing', src: 'https://v/s3', segDone: false })
  })

  it('大白话：全课最后一段播完 → 点下一段换到结业页（带课程 id），不叠栈；没播完时点它不动', async () => {
    const page = await mount()
    page.courseId = 'c1'
    ;(globalThis as any).wx.redirectTo = vi.fn()
    await page.playSegment(seg('s3'), 'enter')
    await flush()
    expect(page.data.canNext).toBe(false)
    page.onNext()
    expect((globalThis as any).wx.redirectTo).not.toHaveBeenCalled()
    page.onEnded()
    page.onNext()
    expect((globalThis as any).wx.redirectTo).toHaveBeenCalledWith({ url: '/pages/finish/finish?courseId=c1' })
  })
})

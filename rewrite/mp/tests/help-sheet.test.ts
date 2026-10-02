// 播放页求助面板（components/help-sheet）：返回键逐层收口、常见问题失败≠没有、关面板先播退场、
// 面板内播视频先让页面停主视频、慢回的旧请求不盖新列表。前几条从 u-mp-player-page / ui-round2-0930 随组件搬来。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { faqMock, videosMock } = vi.hoisted(() => ({ faqMock: vi.fn(), videosMock: vi.fn() }))
vi.mock('../api/learning', () => ({ getHelpVideos: videosMock, getPublicFaq: faqMock }))
vi.mock('../lib/pageContent', () => ({ getPageContent: vi.fn().mockResolvedValue(null) }))
vi.mock('../utils/customerService', () => ({ openCustomerService: vi.fn() }))
vi.mock('../lib/keyFx', () => ({ keyDown: vi.fn(), keyUp: vi.fn() }))

let opts: Record<string, any> = {}
;(globalThis as any).Component = (o: unknown) => {
  opts = o as Record<string, any>
}

async function mount(): Promise<Record<string, any>> {
  vi.resetModules()
  await import('../components/help-sheet/help-sheet')
  const c: Record<string, any> = { data: { ...opts.data, statusBarHeight: 0 }, ...opts.methods, triggerEvent: vi.fn() }
  c.setData = function (patch: Record<string, unknown>) {
    Object.assign(this.data, patch)
  }
  return c
}

const flush = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  faqMock.mockReset()
  videosMock.mockReset()
})
afterEach(() => vi.useRealTimers())

describe('返回键逐层收口', () => {
  it('大白话：面板内播放 → 回列表；列表（视频/问答）→ 菜单；菜单 → 关面板；关着时不处理', async () => {
    const c = await mount()
    expect(c.back()).toBe(false)
    c.open()
    Object.assign(c.data, { helpPanel: 'videos', helpSrc: 'https://h', helpSegName: '起针' })
    expect(c.back()).toBe(true)
    expect(c.data).toMatchObject({ helpPanel: 'videos', helpSrc: '', helpSegName: '' })
    c.back()
    expect(c.data.helpPanel).toBe('menu')
    c.data.helpPanel = 'faq'
    c.back()
    expect(c.data.helpPanel).toBe('menu')
    expect(c.back()).toBe(true)
    expect(c.data.helpPanel).toBe('')
    expect(c.back()).toBe(false)
  })
})

describe('常见问题：失败≠没有', () => {
  it('大白话：后台没配 CMS 问答时拉知识库——失败落 fail、真没有落 empty、有就 ok', async () => {
    const cases: Array<[unknown, string]> = [
      [{ ok: false, error: 'CALL_FAIL' }, 'fail'],
      [{ ok: true, items: [] }, 'empty'],
      [{ ok: true, items: [{ key: 'k', title: '要多久？', content: '3 小时' }] }, 'ok'],
    ]
    for (const [r, state] of cases) {
      faqMock.mockResolvedValueOnce(r)
      const c = await mount()
      c.data.help = { ...c.data.help, faq: [] }
      c.onHelpFaq()
      expect(c.data).toMatchObject({ helpPanel: 'faq', helpFaqState: 'loading' })
      await flush()
      expect(c.data.helpFaqState).toBe(state)
    }
  })

  it('大白话：后台已配 CMS 问答——直接进问答层，不写加载中、不再拉知识库', async () => {
    const c = await mount()
    c.data.help = { ...c.data.help, faq: [{ q: '要多久？', a: '3 小时' }] }
    const patches: Record<string, unknown>[] = []
    const set = c.setData
    c.setData = function (patch: Record<string, unknown>) {
      patches.push(patch)
      set.call(this, patch)
    }
    c.onHelpFaq()
    expect(c.data.helpPanel).toBe('faq')
    expect(patches.some((p) => p.helpFaqState === 'loading')).toBe(false)
    expect(faqMock).not.toHaveBeenCalled()
  })
})

describe('关面板', () => {
  it('大白话：点遮罩/关闭先播退场 240ms 再关，连同面板内播放一起卸掉', async () => {
    const c = await mount()
    Object.assign(c.data, { helpPanel: 'videos', helpSrc: 'https://h' })
    vi.useFakeTimers()
    c.onHelpClose()
    expect(c.data).toMatchObject({ helpOut: true, helpPanel: 'videos' })
    vi.advanceTimersByTime(240)
    expect(c.data).toMatchObject({ helpOut: false, helpPanel: '', helpSrc: '' })
  })
})

describe('帮助视频', () => {
  it('大白话：点一段可播的——先通知页面停主视频，再在面板里播；没地址的段点了不动', async () => {
    const c = await mount()
    c.onHelpPlaySegment({ currentTarget: { dataset: { url: '', name: '空' } } })
    expect(c.triggerEvent).not.toHaveBeenCalled()
    c.onHelpPlaySegment({ currentTarget: { dataset: { url: 'https://h', name: '起针' } } })
    expect(c.triggerEvent).toHaveBeenCalledWith('pausemain')
    expect(c.data).toMatchObject({ helpSrc: 'https://h', helpSegName: '起针' })
  })

  it('大白话：快速退出再进，慢回的第一次请求不盖掉第二次的列表', async () => {
    let first: (v: unknown) => void = () => {}
    videosMock.mockImplementationOnce(() => new Promise((r) => (first = r))).mockResolvedValueOnce({ ok: true, items: [] })
    const c = await mount()
    c.onHelpVideos()
    c.onHelpVideos()
    await flush()
    const after = c.data.helpVideosState
    first({ ok: true, items: [{ id: 't', title: '旧', segments: [] }] }) // 若没被丢弃会解析出 1 个主题
    await flush()
    expect(c.data.helpVideosState).toBe(after)
    expect(c.data.helpTopics).toEqual([])
  })
})

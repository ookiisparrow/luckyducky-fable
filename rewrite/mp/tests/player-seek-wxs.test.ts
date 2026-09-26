// 自绘 seek 条拖动几何 WXS 化（批5·根因#15：60Hz touchmove 每帧 5 字段 setData 双向过桥＝跟手延迟/掉帧源；
// #5：拖动秒/磁吸数学在 seek.wxs（ES5 独立运行时）与 lib/player.ts 双源，须对拍钉死不漂）。三件事：
// ① clampSeek/nearestMark 数学逐点对拍——抽 seek.wxs 函数体真跑（new Function），与 lib/player.ts 单源版逐点比对
//    （WXS 进不了 tsc 编译面，抄式子必然双源·病根#5·覆盖边界 0/负值/超 dur/磁吸半径内外/marks 空）；
// ② 整个 seek.wxs 模块真跑，callMethod 转给挂载的真播放页：拖动中只过秒回桥（onSeekTick）、绝不提交，
//    松手才 onSeekCommit 真 seek（两段式）；预览浮层按 seekCfg.edgePx 夹边；
// ③ wxml 挂 wxs 与 sk.* 绑定（wxml 无运行时，静态断言·错题本 E2）。
// rewrite/mp/tsconfig.json 无 @types/node，走 vitest 的 Vite `?raw` 原文导入（见 tests/raw-imports.d.ts）。
import { describe, it, expect, vi } from 'vitest'
import { clampSeek, nearestMark } from '../lib/player'
import seekWxsRaw from '../pages/player/seek.wxs?raw'
import playerWxmlRaw from '../pages/player/player.wxml?raw'

vi.mock('../api/learning', () => ({ trackEvent: vi.fn(), getHelpVideos: vi.fn(), getPublicFaq: vi.fn(), getPlaybackUrl: vi.fn() }))
vi.mock('../lib/courses', () => ({ getCourseByIdDetailed: vi.fn() }))
vi.mock('../lib/pageContent', () => ({ getPageContent: vi.fn().mockResolvedValue(null) }))
vi.mock('../utils/customerService', () => ({ openCustomerService: vi.fn() }))
vi.mock('../lib/nav', () => ({ goBackOrHome: vi.fn() }))

// 抽 seek.wxs 顶层 `function name(args) { ... \n}` 的函数体（顶层闭合 } 在行首·内部 } 均缩进·非贪婪到首个行首 }）。
function extractWxsFn(src: string, sig: string, args: string): (...a: unknown[]) => unknown {
  const re = new RegExp('function ' + sig.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([\\s\\S]*?)\\n\\}')
  const m = src.match(re)
  if (!m) throw new Error('seek.wxs 抽不出函数：' + sig)
  return new Function(...args.split(',').map((s) => s.trim()), m[1]) as (...a: unknown[]) => unknown
}

const wxsClampSeek = extractWxsFn(seekWxsRaw, 'clampSeek(value, durSec)', 'value, durSec') as (v: number, d: number) => number
const wxsNearestMark = extractWxsFn(seekWxsRaw, 'nearestMark(sec, marks, windowSec)', 'sec, marks, windowSec') as (
  s: number,
  m: { at: number; name: string }[],
  w: number
) => { at: number; name: string } | null

describe('seek.wxs clampSeek 与 lib/player.ts 逐点对拍（双源数学·病根#5）', () => {
  it('大白话：抽出 wxs 的 clampSeek 真跑，各类脏值/边界与 TS 单源版逐点一致', () => {
    const values = [-100, -5, -0.4, 0, 0.9, 30, 30.9, 59.5, 119, 120, 121, 200, NaN, Infinity]
    const durs = [0, 1, 120, 3600]
    for (const v of values) {
      for (const d of durs) {
        expect(wxsClampSeek(v, d)).toBe(clampSeek(v, d))
      }
    }
  })
})

describe('seek.wxs nearestMark 与 lib/player.ts 逐点对拍（磁吸·病根#5·半径内外/等距/空表）', () => {
  const MARKS = [
    { at: 10, name: 'A' },
    { at: 20, name: 'B' },
    { at: 30, name: 'C' },
  ]
  const grids: { marks: { at: number; name: string }[]; window: number }[] = [
    { marks: MARKS, window: 3 },
    { marks: MARKS, window: 5 },
    { marks: MARKS, window: 0 }, // 非正窗口 → null
    { marks: MARKS, window: -1 },
    { marks: [], window: 5 }, // 空表 → null
    { marks: [{ at: 15, name: 'M' }], window: 5 },
  ]
  it('大白话：sec 从 0 扫到 40（含磁吸半径边界与等距点），wxs 版与 TS 单源版命中的节点逐点一致', () => {
    for (const g of grids) {
      for (let sec = 0; sec <= 40; sec++) {
        expect(wxsNearestMark(sec, g.marks, g.window)).toEqual(nearestMark(sec, g.marks, g.window))
      }
    }
  })
  it('大白话：等距取 at 较小者——sec=15 在 [10,20] 正中，两版都取 at=10', () => {
    expect(wxsNearestMark(15, MARKS, 10)).toEqual({ at: 10, name: 'A' })
    expect(wxsNearestMark(15, MARKS, 10)).toEqual(nearestMark(15, MARKS, 10))
  })
})

describe('wxml 挂 seek.wxs 与 sk.* 绑定（静态·E2：抄一半真机才炸）', () => {
  it('大白话：wxml 挂 <wxs src="./seek.wxs">、seek 容器触摸绑定 + change:cfg 下发几何', () => {
    const wxml = playerWxmlRaw.replace(/<!--[\s\S]*?-->/g, '')
    expect(wxml).toMatch(/<wxs\s+[^>]*src\s*=\s*"\.\/seek\.wxs"/)
    expect(wxml).toMatch(/bind:touchstart\s*=\s*"\{\{\s*sk\.onStart\s*\}\}"/)
    expect(wxml).toMatch(/catch:touchmove\s*=\s*"\{\{\s*sk\.onMove\s*\}\}"/)
    expect(wxml).toMatch(/bind:touchend\s*=\s*"\{\{\s*sk\.onEnd\s*\}\}"/)
    expect(wxml).toMatch(/change:cfg\s*=\s*"\{\{\s*sk\.onCfg\s*\}\}"/)
    expect(wxml).toMatch(/cfg\s*=\s*"\{\{\s*seekCfg\s*\}\}"/)
  })
})

describe('seek.wxs 整模块真跑 × 真播放页（两段式：拖动中只过秒，松手才 seek）', () => {
  function loadWxs(): Record<string, (...a: unknown[]) => void> {
    const mod = { exports: {} as Record<string, (...a: unknown[]) => void> }
    new Function('module', seekWxsRaw)(mod)
    return mod.exports
  }

  async function setup() {
    let opts: Record<string, any> = {}
    ;(globalThis as any).Page = (o: Record<string, any>) => (opts = o)
    const video = { seek: vi.fn(), play: vi.fn() }
    ;(globalThis as any).wx = { createVideoContext: () => video, vibrateShort: vi.fn() }
    vi.resetModules()
    await import('../pages/player/player')
    const page = Object.create(opts) as Record<string, any>
    page.data = { ...opts.data, current: { segmentId: 's1', marks: [{ at: 50, name: '起针' }] }, durSec: 200, paused: false }
    page.setData = function (patch: Record<string, unknown>) {
      Object.assign(this.data as Record<string, unknown>, patch)
    }
    page.windowWidthPx = 375
    page._seekRect = { left: 0, width: 300 }
    const styles: Record<string, unknown>[] = []
    const calls: Array<[string, Record<string, number>]> = []
    const node = (cls: string) => ({ setStyle: (st: Record<string, unknown>) => styles.push({ cls, ...st }), addClass: vi.fn(), removeClass: vi.fn() })
    const ow = {
      selectComponent: (cls: string) => node(cls),
      callMethod: (name: string, arg: Record<string, number>) => {
        calls.push([name, arg])
        page[name](arg) // 逻辑层方法不存在即抛：callMethod 指名的落点必须真在页面上
      },
    }
    const sk = loadWxs()
    sk.onCfg(page.buildSeekCfg(200, page.data.current.marks), null, ow)
    return { page, video, sk, ow, calls, styles }
  }
  const touch = (clientX: number) => ({ touches: [{ clientX }] })

  it('大白话：模块导出 onCfg/onPct/onStart/onMove/onEnd 五个处理器', () => {
    const sk = loadWxs()
    for (const fn of ['onCfg', 'onPct', 'onStart', 'onMove', 'onEnd']) expect(typeof sk[fn], fn).toBe('function')
  })

  it('大白话：按下→拖动只经 onSeekTick 回桥、视频不动；松手才 onSeekCommit，视频 seek 到落位秒', async () => {
    const { page, video, sk, ow, calls } = await setup()
    sk.onStart(touch(30), ow) // 30/300×200 = 20 秒
    sk.onMove(touch(90), ow) // 60 秒
    sk.onMove(touch(78), ow) // 52 秒，落在「起针」50 秒磁吸窗内
    expect(calls.map((c) => c[0])).toEqual(['onSeekTick', 'onSeekTick', 'onSeekTick'])
    expect(calls[2][1]).toEqual({ sec: 50, snapAt: 50 })
    expect(page.data.seeking).toBe(true)
    expect(video.seek).not.toHaveBeenCalled()

    sk.onEnd({}, ow)
    expect(calls[3]).toEqual(['onSeekCommit', { sec: 50 }])
    expect(video.seek).toHaveBeenCalledWith(50)
    expect(page.data).toMatchObject({ seeking: false, curSec: 50, seekPct: 25 })
  })

  it('大白话：几何没下发（没量到轨道）时按下不响应，松手也不提交', async () => {
    const { video, sk, ow, calls } = await setup()
    sk.onCfg(null, null, ow)
    sk.onStart(touch(30), ow)
    sk.onMove(touch(90), ow)
    sk.onEnd({}, ow)
    expect(calls).toEqual([])
    expect(video.seek).not.toHaveBeenCalled()
  })

  it('大白话：预览浮层按 seekCfg.edgePx 夹边，拖到最左也不出屏', async () => {
    const { sk, ow, styles } = await setup()
    sk.onStart(touch(0), ow)
    const preview = styles.filter((st) => st.cls === '.lp-seek-preview').pop()
    expect(preview).toEqual({ cls: '.lp-seek-preview', left: '32px' }) // 64rpx × 375/750
  })
})

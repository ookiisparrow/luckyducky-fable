// 像素画改用普通元素渲染（不再用 <canvas>：canvas 是原生组件，放在 scroll-view 里滚动会漂、会盖住 TabBar）。
// 一帧 = 每行一条硬色标渐变；同色相邻格合并成一段，透明处留空。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { rowGradients, mountPixelView } from '../lib/pixelView'

describe('rowGradients', () => {
  it('大白话：同一行相邻同色格合并成一段，段与段之间是透明，最后收成透明', () => {
    const rows = rowGradients(
      [
        [0, 0, '#111'],
        [1, 0, '#111'],
        [3, 0, '#abc'],
      ],
      2,
      4
    )
    expect(rows).toEqual([
      'linear-gradient(to right,#111 0px,#111 8px,transparent 8px,transparent 12px,#abc 12px,#abc 16px,transparent 16px)',
      '',
    ])
  })

  it('大白话：后画的格盖住先画的（同一格以最后一次为准），越界的格丢掉', () => {
    const rows = rowGradients(
      [
        [0, 0, '#111'],
        [0, 0, '#f00'],
        [-1, 0, '#111'],
        [5, 0, '#111'],
        [0, 9, '#111'],
      ],
      1,
      2,
      2
    )
    expect(rows).toEqual(['linear-gradient(to right,#f00 0px,#f00 2px,transparent 2px)'])
  })

  it('大白话：坐标是小数（动画插值）时四舍五入到整格，不出半格', () => {
    expect(rowGradients([[0.6, 0.4, '#111']], 1, 2)).toEqual(['linear-gradient(to right,transparent 0px,transparent 2px,#111 2px,#111 4px,transparent 4px)'])
  })
})

// 切页掉帧（老板 2026-09-30「页面切换的按钮有掉帧、卡顿感」）：屏外挂上的动效不在后台空跑、静止画面停表。
// 露面即动，不做「先定格一会儿再动」（老板 2026-10-01：动画不要停 0.4 秒）。
describe('mountPixelView：切页不抢帧、屏外不跑', () => {
  type IoCb = (r: { intersectionRatio: number }) => void
  // top＝挂上时量到的位置（屏高 667）：开发者工具实测屏内挂上时观察器不一定回话，起播按挂上时实测位置判定
  function host(top = 100) {
    let io: IoCb = () => {}
    return {
      setData: vi.fn(),
      createSelectorQuery: () => ({ select: () => ({ boundingClientRect: () => ({ exec: (cb: (r: unknown[]) => void) => cb([{ width: 26, top, bottom: top + 26 }]) }) }) }),
      createIntersectionObserver: () => ({ relativeToViewport: () => ({ observe: (_s: string, cb: IoCb) => (io = cb) }), disconnect: vi.fn() }),
      see: (v: boolean) => io({ intersectionRatio: v ? 1 : 0 }),
    }
  }
  let frame = 0
  const draw = (_t: number, P: (x: number, y: number, c: string) => void) => {
    frame++
    P(frame % 13, 0, '#111') // 每帧画面都变：setData 次数＝真画了几帧
  }
  beforeEach(() => {
    vi.useFakeTimers()
    frame = 0
    ;(globalThis as any).wx = { getWindowInfo: () => ({ windowHeight: 667 }) }
  })
  afterEach(() => vi.useRealTimers())
  const frames = (h: ReturnType<typeof host>) => h.setData.mock.calls.filter((c) => Object.keys(c[0] as object).some((k) => k.startsWith('pxRows['))).length

  it('大白话：屏内挂上马上就动，不定格等待（观察器不回话也照动）', () => {
    const h = host()
    mountPixelView(h as never, { cols: 13, rows: 13 }, 2, draw)
    vi.advanceTimersByTime(200)
    expect(frames(h)).toBeGreaterThan(2)
  })
  it('大白话：屏外挂上（首屏以下）——只有那一帧静止画面，不在后台空跑；滚进屏才动', () => {
    const h = host(2000)
    mountPixelView(h as never, { cols: 13, rows: 13 }, 2, draw)
    vi.advanceTimersByTime(3000)
    expect(frames(h)).toBe(1)
    h.see(true)
    vi.advanceTimersByTime(1000)
    expect(frames(h)).toBeGreaterThan(3)
  })
  it('大白话：切走停；返回本页马上接着动', () => {
    const h = host()
    const v = mountPixelView(h as never, { cols: 13, rows: 13 }, 2, draw)
    h.see(true)
    vi.advanceTimersByTime(1000)
    v.setVisible(false)
    const n = frames(h)
    vi.advanceTimersByTime(1000)
    expect(frames(h)).toBe(n)
    v.setVisible(true)
    vi.advanceTimersByTime(200)
    expect(frames(h)).toBeGreaterThan(n + 1)
  })
  it('大白话：画面静止（draw 返回 false）就停表，不再每 66ms 空算', () => {
    const h = host()
    const still = vi.fn(() => false)
    mountPixelView(h as never, { cols: 13, rows: 13 }, 2, still)
    h.see(true)
    vi.advanceTimersByTime(3000)
    expect(still.mock.calls.length).toBeLessThanOrEqual(2)
  })
})

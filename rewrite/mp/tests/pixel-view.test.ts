// 像素画改用普通元素渲染（不再用 <canvas>：canvas 是原生组件，放在 scroll-view 里滚动会漂、会盖住 TabBar）。
// 一帧 = 每行一条硬色标渐变；同色相邻格合并成一段，透明处留空。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetForTest, mountPixelView, rowGradients } from '../lib/pixelView'

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

// 假组件宿主：量宽回 52px、视口观察器立刻报「在视口内」、setData 记时刻并立刻回执（像渲染层画完回调）。
// page＝getPageId；group＝挂 groupSetData（记次数、记 setData 是否发生在它里面）；held＝回执攒着不回（测背压）
type Group = { calls: number; inside: boolean; flags: boolean[] }
function fakeHost(calls: number[], o: { page?: string; group?: Group; held?: (() => void)[] } = {}) {
  const h: Record<string, unknown> = {
    setData: (_d: unknown, cb?: () => void) => {
      calls.push(Date.now())
      if (o.group) o.group.flags.push(o.group.inside)
      if (cb) o.held ? o.held.push(cb) : cb()
    },
    createSelectorQuery: () => ({ select: () => ({ boundingClientRect: () => ({ exec: (cb: (r: unknown[]) => void) => cb([{ width: 52 }]) }) }) }),
    createIntersectionObserver: () => ({
      relativeToViewport: () => ({ observe: (_s: string, cb: (r: { intersectionRatio: number }) => void) => cb({ intersectionRatio: 1 }), disconnect() {} }),
    }),
  }
  if (o.page !== undefined) h.getPageId = () => o.page
  const g = o.group
  if (g)
    h.groupSetData = (fn: () => void) => {
      g.calls++
      g.inside = true
      fn()
      g.inside = false
    }
  return h as unknown as WechatMiniprogram.Component.TrivialInstance
}
const newGroup = (): Group => ({ calls: 0, inside: false, flags: [] })
// 66ms 挪一格（不是每帧都变）
const moving = (t: number, P: (x: number, y: number, c: string) => void) => P(Math.floor(t / 66) % 13, 0, '#111')
// 每帧（16ms）挪一格：保证每帧都有行变化、都会 setData
const everyFrame = (t: number, P: (x: number, y: number, c: string) => void) => P(Math.round(t / 16) % 13, 0, '#111')

describe('mountPixelView 共享帧调度', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    __resetForTest()
  })
  afterEach(() => vi.useRealTimers())

  it('大白话：一页多个像素画只开一个计时器，每帧各自的 setData 在同一趟里连发；全销毁后计时器清零', () => {
    const a: number[] = []
    const b: number[] = []
    const va = mountPixelView(fakeHost(a), { cols: 13, rows: 1 }, 4, moving)
    const vb = mountPixelView(fakeHost(b), { cols: 13, rows: 1 }, 4, moving)
    expect(a.length).toBe(2) // 初始化 + 首帧
    expect(vi.getTimerCount()).toBe(1) // 两个视图共用一个计时器
    vi.advanceTimersByTime(66 * 3)
    expect(a.length).toBeGreaterThan(2)
    expect(a.length).toBe(b.length) // 同步推进
    expect(a[a.length - 1]).toBe(b[b.length - 1]) // 最后一帧落在同一时刻
    expect(vi.getTimerCount()).toBe(1)
    va.destroy()
    vi.advanceTimersByTime(66)
    expect(vi.getTimerCount()).toBe(1) // b 还在动
    vb.destroy()
    vi.advanceTimersByTime(66)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('大白话：draw 返回 false（画面静止）就从调度里摘掉、不再空转；kick 再唤醒', () => {
    const a: number[] = []
    const v = mountPixelView(fakeHost(a), { cols: 13, rows: 1 }, 4, (t, P) => {
      P(0, 0, '#111')
      return t < 100
    })
    vi.advanceTimersByTime(66 * 5)
    expect(vi.getTimerCount()).toBe(0)
    v.kick()
    expect(vi.getTimerCount()).toBe(1)
    v.destroy()
  })

  it('大白话：照设计稿 60fps——画面每帧都变时，每 16ms 出一帧', () => {
    const a: number[] = []
    const v = mountPixelView(fakeHost(a), { cols: 13, rows: 1 }, 4, everyFrame)
    a.length = 0
    vi.advanceTimersByTime(16 * 10)
    expect(a.length).toBeGreaterThanOrEqual(10)
    v.destroy()
  })

  it('大白话：同一页的几个像素画，每帧的 setData 都包在这一页的一次 groupSetData 里（同步成一次绘制）；不同页各包各的', () => {
    const g1 = newGroup()
    const g2 = newGroup()
    const a: number[] = []
    const b: number[] = []
    const c: number[] = []
    const views = [
      mountPixelView(fakeHost(a, { page: 'p1', group: g1 }), { cols: 13, rows: 1 }, 4, everyFrame),
      mountPixelView(fakeHost(b, { page: 'p1', group: g1 }), { cols: 13, rows: 1 }, 4, everyFrame),
      mountPixelView(fakeHost(c, { page: 'p2', group: g2 }), { cols: 13, rows: 1 }, 4, everyFrame),
    ]
    g1.flags.length = 0 // 挂载时的骨架 + 首帧不走调度，不算
    g2.flags.length = 0
    vi.advanceTimersByTime(16 * 6)
    const n = g1.calls
    expect(n).toBeGreaterThan(3)
    expect(g2.calls).toBe(n) // 每帧每页一次
    expect(a.length - 2).toBe(n) // p1 两个视图每帧各一次 setData，都在那一次 groupSetData 里
    expect(b.length - 2).toBe(n)
    expect(c.length - 2).toBe(n)
    expect([...g1.flags, ...g2.flags].every(Boolean)).toBe(true)
    for (const v of views) v.destroy()
  })

  it('大白话：背压——自己上一帧渲染层还没回执就跳过（不在渲染层排队）；回执一到下一帧接着画；一直不回执满 200ms 重发；被重发取代的旧回执迟到不算数', () => {
    const a: number[] = []
    const held: (() => void)[] = []
    const v = mountPixelView(fakeHost(a, { held }), { cols: 13, rows: 1 }, 4, everyFrame)
    expect(a.length).toBe(2) // 挂载：骨架 + 首帧；首帧的回执攒着
    vi.advanceTimersByTime(16 * 6) // 首帧没回执：一帧都不出
    expect(a.length).toBe(2)
    held[0]() // 首帧回执到
    vi.advanceTimersByTime(16) // 下一帧接着画
    expect(a.length).toBe(3)
    vi.advanceTimersByTime(150) // 又不回执：自上次发出不到 200ms，不出
    expect(a.length).toBe(3)
    vi.advanceTimersByTime(64) // 满 200ms：重发一帧
    expect(a.length).toBe(4)
    held[1]() // 被重发取代的那帧的回执迟到：不算数，仍在等新那帧
    vi.advanceTimersByTime(16)
    expect(a.length).toBe(4)
    expect(vi.getTimerCount()).toBe(1)
    v.destroy()
  })

  it('大白话：一个视图的回执永远不来（后台页上的视图，渲染层不画）——只卡它自己，别的视图照常每 16ms 一帧（模拟器实测过：做成全局背压会把全站拖到 5fps）', () => {
    const stuck: number[] = []
    const ok: number[] = []
    const vs = mountPixelView(fakeHost(stuck, { page: 'bg', held: [] }), { cols: 13, rows: 1 }, 4, everyFrame)
    const vo = mountPixelView(fakeHost(ok, { page: 'fg' }), { cols: 13, rows: 1 }, 4, everyFrame)
    ok.length = 0
    vi.advanceTimersByTime(16 * 10)
    expect(ok.length).toBeGreaterThanOrEqual(10)
    expect(stuck.length).toBe(2) // 自己只是在等回执
    vs.destroy()
    vo.destroy()
  })

  it('大白话：不在前台页（页栈顶）的像素画先停——后台页上才创建的视图收不到 hide，靠这个停下；回前台 kick 一下就续上', () => {
    let front = 'fg'
    const g = globalThis as unknown as { getCurrentPages?: () => unknown[] }
    g.getCurrentPages = () => [{ getPageId: () => 'old' }, { getPageId: () => front }]
    try {
      const bg: number[] = []
      const fg: number[] = []
      const vb = mountPixelView(fakeHost(bg, { page: 'bg' }), { cols: 13, rows: 1 }, 4, everyFrame)
      const vf = mountPixelView(fakeHost(fg, { page: 'fg' }), { cols: 13, rows: 1 }, 4, everyFrame)
      vi.advanceTimersByTime(16 * 6)
      expect(bg.length).toBe(2) // 只有挂载那两次（骨架 + 首帧），之后不出
      expect(fg.length).toBeGreaterThanOrEqual(2 + 6)
      front = 'bg' // 那页回到前台：pageLifetimes.show → setVisible(true) → kick
      vb.setVisible(true)
      vi.advanceTimersByTime(16 * 3)
      expect(bg.length).toBeGreaterThanOrEqual(2 + 3)
      vb.destroy()
      vf.destroy()
    } finally {
      delete g.getCurrentPages
    }
  })
})

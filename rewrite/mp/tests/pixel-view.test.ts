// 像素画改用普通元素渲染（不再用 <canvas>：canvas 是原生组件，放在 scroll-view 里滚动会漂、会盖住 TabBar）。
// 一帧 = 每行一条硬色标渐变；同色相邻格合并成一段，透明处留空。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountPixelView, rowGradients } from '../lib/pixelView'

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

// 假组件宿主：量宽回 52px、视口观察器立刻报「在视口内」、setData 只记时刻
function fakeHost(calls: number[]) {
  return {
    setData: () => calls.push(Date.now()),
    createSelectorQuery: () => ({ select: () => ({ boundingClientRect: () => ({ exec: (cb: (r: unknown[]) => void) => cb([{ width: 52 }]) }) }) }),
    createIntersectionObserver: () => ({
      relativeToViewport: () => ({ observe: (_s: string, cb: (r: { intersectionRatio: number }) => void) => cb({ intersectionRatio: 1 }), disconnect() {} }),
    }),
  } as unknown as WechatMiniprogram.Component.TrivialInstance
}
// 每帧挪一格：保证每帧都有行变化、都会 setData
const moving = (t: number, P: (x: number, y: number, c: string) => void) => P(Math.floor(t / 66) % 13, 0, '#111')

describe('mountPixelView 共享帧调度', () => {
  beforeEach(() => vi.useFakeTimers())
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
})

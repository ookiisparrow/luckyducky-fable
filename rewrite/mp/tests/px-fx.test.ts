// v5 像素撒花/转场（lib/pxFx·设计稿 party / fxEnter / fxRainbow 原参数移植）。
import { describe, it, expect, vi } from 'vitest'
import { distField, ditherRuns, rainbowRuns, party, stepConfetti, fxTransit, fxToast, PX, PAPER, RAINBOW_DUR, type Bit, type Runs } from '../lib/pxFx'

const W = 80
const H = 60
const KEY = { left: 20, top: 20, right: 40, bottom: 32 }
const F = distField(W, H, KEY)
// 每行各色段宽加起来＝本行被画到的像素宽
const rowCover = (r: Runs) => {
  const m: Record<number, number> = {}
  for (const c in r) for (let i = 0; i < r[c].length; i += 3) m[r[c][i + 1]] = (m[r[c][i + 1]] || 0) + r[c][i + 2]
  return m
}

describe('像素转场', () => {
  it('大白话：暗场起点什么都不画、终点整屏铺满（每行都铺到全宽，不留缝）', () => {
    expect(ditherRuns(F, 0)).toEqual({})
    const cover = rowCover(ditherRuns(F, 1))
    expect(Object.keys(cover).length).toBe(F.rows)
    expect(Object.values(cover).every((w) => w === F.cols * PX)).toBe(true)
  })

  it('大白话：彩虹先只把那颗键点亮成紫色；跑完时整屏是纸色（新页底色），跳页时接得上', () => {
    const lit = rainbowRuns(F, -50, {})
    expect(Object.keys(lit)).toEqual(['#8A5AE0'])
    const cover = rowCover(lit)
    expect(Object.values(cover).every((w) => w === KEY.right - KEY.left)).toBe(true) // 同一行键内格并成一段
    const end = rainbowRuns(F, RAINBOW_DUR * 3, { rev: 0 })
    expect(Object.keys(end)).toEqual([PAPER])
  })

  it('大白话：拿不到特效层（老页面/没挂 px-fx）直接跳页，转场不挡路', async () => {
    const go = vi.fn()
    await fxTransit({ selectComponent: () => null, createSelectorQuery: () => ({}) as never }, 'rainbow', '.x', go)
    expect(go).toHaveBeenCalledTimes(1)
  })
})

describe('成功轻提示', () => {
  it('大白话：页面挂了特效层就用设计稿的像素 ✓ 提示；没挂（或测试里的假页面）退回原生成功提示，文案不变', () => {
    const toast = vi.fn()
    fxToast({ selectComponent: () => ({ toast }), createSelectorQuery: () => ({}) as never }, '已支付')
    expect(toast).toHaveBeenCalledWith('已支付', true)
    const showToast = vi.fn()
    ;(globalThis as Record<string, unknown>).wx = { showToast }
    fxToast({} as never, '支付成功')
    expect(showToast).toHaveBeenCalledWith({ title: '支付成功', icon: 'success' })
  })
})

describe('像素撒花', () => {
  it('大白话：小撒花 96 片、大撒花键两轮加两侧各 70；落在 4px 网格上；几秒后全部落完清空', () => {
    let seed = 1
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    const small: Bit[] = []
    party(small, KEY, { w: W, h: H }, false, undefined, rnd)
    expect(small.length).toBe(96)
    const big: Bit[] = []
    party(big, KEY, { w: 390, h: 800 }, true, undefined, rnd)
    expect(big.length).toBe(160 + 96 + 140)
    let chips = stepConfetti(big, 200, 800, rnd)
    expect(chips.length).toBeGreaterThan(0)
    expect(chips.every((c) => c.x % PX === 0 && c.y % PX === 0)).toBe(true)
    for (let t = 0; t < 4000 && big.length; t += 16) chips = stepConfetti(big, 16, 800, rnd)
    expect(big.length).toBe(0)
  })
})

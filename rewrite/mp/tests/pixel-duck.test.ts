// 登录半屏探头小鸭 drawDuck 时间轴直测（lib/pixelDuck）：藏→冒出→眨眼→停帧。
import { describe, it, expect } from 'vitest'
import { drawDuck, DUCK_ROWS } from '../lib/pixelDuck'

function frame(t: number) {
  const cells: { x: number; y: number; c: string }[] = []
  const more = drawDuck(t, (x, y, c) => cells.push({ x, y, c }))
  const visible = cells.filter((p) => p.y < DUCK_ROWS)
  const eye = cells.find((p) => p.x === 5 && p.c !== '#F2D27A' && p.c !== '#E98A6E')
  return { more, visible, eye }
}

describe('drawDuck（探头小鸭时间轴）', () => {
  it('大白话：120ms 前整只藏着，还在播', () => {
    expect(frame(0)).toMatchObject({ more: true, visible: [] })
    expect(frame(119).visible).toEqual([])
  })

  it('大白话：120–360ms 从下往上冒出，冒到一半只露上半身', () => {
    const mid = frame(240).visible.length
    const full = frame(400).visible.length
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(full)
  })

  it('大白话：820–940ms 眨眼（眼睛换眼睑色），1000ms 后停帧', () => {
    expect(frame(700).eye?.c).toBe('#1c1c1a')
    expect(frame(900).eye?.c).toBe('#B8923F')
    expect(frame(999).more).toBe(true)
    expect(frame(1000)).toMatchObject({ more: false })
    expect(frame(1000).eye?.c).toBe('#1c1c1a')
  })
})

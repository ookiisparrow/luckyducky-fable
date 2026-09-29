// 按住确认（v5 危险操作：浅色键 + 红字 + 长按）：按满 ms 才触发；松手太快（<400ms）给「按住…」提示；中途松手不触发。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHold } from '../lib/hold'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('createHold', () => {
  it('大白话：按满时长才触发，触发前进度态为真、触发后复位', () => {
    const fire = vi.fn()
    const states: boolean[] = []
    const h = createHold(600, fire, { onChange: (v) => states.push(v) })
    h.start()
    vi.advanceTimersByTime(599)
    expect(fire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fire).toHaveBeenCalledTimes(1)
    expect(states).toEqual([true, false])
    h.end() // 触发后再松手不重复触发、不提示
    expect(fire).toHaveBeenCalledTimes(1)
  })

  it('大白话：点一下就松（<400ms）→ 不触发，提示按住；按了一半松（≥400ms）→ 不触发也不提示', () => {
    const fire = vi.fn()
    const quick = vi.fn()
    const h = createHold(900, fire, { onQuick: quick })
    h.start()
    vi.advanceTimersByTime(150)
    h.end()
    expect(quick).toHaveBeenCalledTimes(1)
    h.start()
    vi.advanceTimersByTime(500)
    h.end()
    vi.advanceTimersByTime(2000)
    expect(fire).not.toHaveBeenCalled()
    expect(quick).toHaveBeenCalledTimes(1)
  })

  it('大白话：cancel（页面卸载/手指滑走）立刻作废计时', () => {
    const fire = vi.fn()
    const h = createHold(300, fire)
    h.start()
    h.cancel()
    vi.advanceTimersByTime(1000)
    expect(fire).not.toHaveBeenCalled()
  })
})

// UX 审查（2026-09-28）：手指落在按住键上顺势滑动列表，计时照走会误删/误取消订单——手指移动超过 10px 即作废。
describe('按住中手指移动', () => {
  it('大白话：按住后手指挪开超过 10px——作废，不触发；只抖几像素（≤10px）——照常触发', () => {
    const fire = vi.fn()
    const states: boolean[] = []
    const h = createHold(700, fire, { onChange: (v) => states.push(v) })
    h.start(100, 300)
    h.move(100, 288) // 上滑 12px
    vi.advanceTimersByTime(1000)
    expect(fire).not.toHaveBeenCalled()
    expect(states).toEqual([true, false])

    h.start(100, 300)
    h.move(106, 306) // 抖了约 8.5px
    vi.advanceTimersByTime(700)
    expect(fire).toHaveBeenCalledTimes(1)
  })

  it('大白话：没记起点（只调 start()）时 move 不误伤', () => {
    const fire = vi.fn()
    const h = createHold(700, fire)
    h.start()
    h.move(0, 500)
    vi.advanceTimersByTime(700)
    expect(fire).toHaveBeenCalledTimes(1)
  })
})

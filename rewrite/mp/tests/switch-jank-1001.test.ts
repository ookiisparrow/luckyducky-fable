// 切页掉帧（老板 2026-09-30「页面切换的按钮有掉帧、卡顿感」）：停掉切走后仍在跑的动效。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mountMock } = vi.hoisted(() => ({ mountMock: vi.fn() }))
vi.mock('../lib/pixelView', () => ({ mountPixelView: mountMock }))
vi.mock('../lib/haptics', () => ({ burstHaptic: vi.fn(), tapHaptic: vi.fn() }))
vi.mock('../lib/keyFx', () => ({ keyDown: vi.fn(), keyUp: vi.fn(), keyPress: vi.fn() }))

let opts: Record<string, any> = {}
;(globalThis as any).Component = (o: unknown) => {
  opts = o as Record<string, any>
}
function mount(o: Record<string, any>, props: Record<string, unknown> = {}) {
  const c: Record<string, any> = { data: { ...o.data, ...props }, ...o.methods }
  c.setData = function (patch: Record<string, unknown>, cb?: () => void) {
    Object.assign(this.data, patch)
    cb?.()
  }
  return c
}

beforeEach(() => {
  mountMock.mockReset().mockReturnValue({ kick: vi.fn(), setVisible: vi.fn(), destroy: vi.fn() })
  ;(globalThis as any).wx = { getWindowInfo: () => ({ windowWidth: 375, windowHeight: 667, pixelRatio: 2 }) }
})

describe('px-anim hold：播到定格就停表', () => {
  it('大白话：定格之前照常画；过了 hold 时刻 draw 报「画面静止」，循环不再每 66ms 空算', async () => {
    vi.resetModules()
    await import('../components/px-anim/px-anim')
    const props: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(opts.properties as Record<string, { value: unknown }>)) props[k] = v.value
    const c = mount(opts, { ...props, name: 'checkin', hold: 700 })
    opts.lifetimes.ready.call(c)
    const draw = mountMock.mock.calls[0][3] as (t: number, P: () => void) => boolean | void
    expect(draw(100, () => {})).not.toBe(false)
    expect(draw(800, () => {})).toBe(false)
  })
  it('大白话：不带 hold 的循环动效照旧一直画', async () => {
    vi.resetModules()
    await import('../components/px-anim/px-anim')
    const props: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(opts.properties as Record<string, { value: unknown }>)) props[k] = v.value
    const c = mount(opts, { ...props, name: 'loader' })
    opts.lifetimes.ready.call(c)
    const draw = mountMock.mock.calls[0][3] as (t: number, P: () => void) => boolean | void
    expect(draw(99999, () => {})).not.toBe(false)
  })
})

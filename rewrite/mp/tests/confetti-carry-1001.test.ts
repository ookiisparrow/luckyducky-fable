// 撒花跨页接着落（老板 2026-10-01「切页后撒花在下一页继续落」）：本页没落完就跳页 / 返回，
// 剩下的花由新露面那页的 px-fx 认领、接着落（屏幕坐标，接得上）；本页自己的也照旧落完，不截断。
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/haptics', () => ({ burstHaptic: vi.fn(), tapHaptic: vi.fn() }))
vi.mock('../lib/keyFx', () => ({ keyDown: vi.fn(), keyUp: vi.fn(), keyPress: vi.fn() }))

let opts: Record<string, any> = {}
;(globalThis as any).Component = (o: unknown) => {
  opts = o as Record<string, any>
}
let now = 0
beforeEach(async () => {
  now = 1_000_000
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  ;(globalThis as any).wx = { getWindowInfo: () => ({ windowWidth: 375, windowHeight: 667, pixelRatio: 2 }) }
  vi.resetModules()
  await import('../components/px-fx/px-fx')
})

function mount() {
  const c: Record<string, any> = { data: { ...opts.data }, ...opts.methods }
  c.setData = function (patch: Record<string, unknown>, cb?: () => void) {
    Object.assign(this.data, patch)
    cb?.()
  }
  const frames: ((t: number) => void)[] = []
  const ctx = { clearRect: vi.fn(), fillRect: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), fill: vi.fn(), scale: vi.fn(), fillStyle: '', globalAlpha: 1 }
  const cv = { width: 0, height: 0, getContext: () => ctx, requestAnimationFrame: vi.fn((f: (t: number) => void) => frames.push(f)), cancelAnimationFrame: vi.fn() }
  c.createSelectorQuery = () => ({ select: () => ({ fields: () => ({ exec: (cb: (r: unknown[]) => void) => cb([{ node: cv }]) }) }) })
  c.selectOwnerComponent = () => null
  opts.lifetimes.attached.call(c)
  return { c, cv, ctx, frames }
}
const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve()
}
const KEY = { left: 100, top: 400, right: 200, bottom: 448 }

describe('撒花跨页接着落', () => {
  it('大白话：撒花没落完就跳页——新页一露面就接着画剩下的花；旧页自己的也照旧落完（不截断）', async () => {
    const a = mount()
    await a.c.party(KEY)
    a.frames.shift()!(16) // 旧页先落一帧
    opts.pageLifetimes.hide.call(a.c)
    expect(a.cv.cancelAnimationFrame).not.toHaveBeenCalled() // 旧页不停
    now += 50
    const b = mount()
    opts.lifetimes.ready.call(b.c)
    await flush()
    expect(b.cv.requestAnimationFrame).toHaveBeenCalled()
    b.frames.shift()!(32)
    expect(b.ctx.fillRect.mock.calls.length).toBeGreaterThan(20) // 新页画出了接过来的花
  })
  it('大白话：返回上一页也一样——上一页露面（show）时接着画', async () => {
    const back = mount()
    opts.lifetimes.ready.call(back.c)
    const a = mount()
    await a.c.party(KEY)
    opts.pageLifetimes.hide.call(a.c)
    opts.pageLifetimes.show.call(back.c)
    await flush()
    expect(back.cv.requestAnimationFrame).toHaveBeenCalled()
  })
  it('大白话：花早就该落完了（离开超过 1 秒才露面）不接；没撒花就跳页也不画', async () => {
    const a = mount()
    await a.c.party(KEY)
    opts.pageLifetimes.hide.call(a.c)
    now += 1500
    const b = mount()
    opts.lifetimes.ready.call(b.c)
    await flush()
    expect(b.cv.requestAnimationFrame).not.toHaveBeenCalled()
    const c = mount()
    opts.pageLifetimes.hide.call(c.c)
    const d = mount()
    opts.lifetimes.ready.call(d.c)
    await flush()
    expect(d.cv.requestAnimationFrame).not.toHaveBeenCalled()
  })
})

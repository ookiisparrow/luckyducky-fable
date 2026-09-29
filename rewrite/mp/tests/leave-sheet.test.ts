// 放弃编辑确认（components/leave-sheet·设计稿 LEAVE）：有改动时拦侧滑/返回键先问；老板 2026-09-28 拍板连侧滑也拦。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { backMock } = vi.hoisted(() => ({ backMock: vi.fn() }))
vi.mock('../lib/nav', () => ({ goBackOrHome: backMock }))
vi.mock('../lib/keyFx', () => ({ keyDown: vi.fn(), keyUp: vi.fn() }))

let opts: Record<string, any> = {}
;(globalThis as any).Component = (o: unknown) => {
  opts = o as Record<string, any>
}

async function mount(dirty: boolean): Promise<Record<string, any>> {
  vi.resetModules()
  await import('../components/leave-sheet/leave-sheet')
  const c: Record<string, any> = { data: { ...opts.data, dirty }, ...opts.methods }
  c.setData = function (patch: Record<string, unknown>) {
    Object.assign(this.data, patch)
  }
  opts.observers.dirty.call(c, dirty)
  return c
}

beforeEach(() => {
  vi.useFakeTimers()
  backMock.mockReset()
})
afterEach(() => vi.useRealTimers())

describe('放弃编辑确认', () => {
  it('大白话：没改动——不挂拦截，点返回直接走', async () => {
    const c = await mount(false)
    expect(c.data.armed).toBe(false)
    c.ask()
    expect(backMock).toHaveBeenCalledTimes(1)
    expect(c.data.open).toBe(false)
  })

  it('大白话：有改动——挂上拦截；点返回键或侧滑被拦，都先弹确认、不走', async () => {
    const c = await mount(true)
    expect(c.data.armed).toBe(true)
    c.ask()
    expect(c.data.open).toBe(true)
    expect(backMock).not.toHaveBeenCalled()

    const d = await mount(true)
    d.onBeforeLeave()
    expect(d.data.open).toBe(true)
    expect(d.data.armed).toBe(false)
  })

  it('大白话：点「继续编辑」——半屏下滑收起（240ms），拦截重新挂上，人还在本页', async () => {
    const c = await mount(true)
    c.onBeforeLeave()
    c.onStay()
    expect(c.data.out).toBe(true)
    vi.advanceTimersByTime(240)
    expect(c.data.open).toBe(false)
    expect(c.data.armed).toBe(true)
    expect(backMock).not.toHaveBeenCalled()
  })

  it('大白话：点「放弃」——收起后才返回，且不再拦', async () => {
    const c = await mount(true)
    c.ask()
    c.onGo()
    expect(backMock).not.toHaveBeenCalled()
    vi.advanceTimersByTime(240)
    expect(backMock).toHaveBeenCalledTimes(1)
    expect(c.data.armed).toBe(false)
  })
})

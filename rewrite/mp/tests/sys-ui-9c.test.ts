// 像素化 9c（Claude Design「像素化落地规格.md」·老板 2026-09-30）：提示、加载、确认全部自绘在页面的 px-fx 层。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../lib/haptics', () => ({ burstHaptic: vi.fn(), tapHaptic: vi.fn() }))
vi.mock('../lib/keyFx', () => ({ keyDown: vi.fn(), keyUp: vi.fn(), keyPress: vi.fn() }))

let opts: Record<string, any> = {}
;(globalThis as any).Component = (o: unknown) => {
  opts = o as Record<string, any>
}

async function load() {
  vi.resetModules()
  await import('../components/px-fx/px-fx')
  return opts
}
function mount(o: Record<string, any>): Record<string, any> {
  const c: Record<string, any> = { data: { ...o.data }, ...o.methods }
  c.setData = function (patch: Record<string, unknown>) {
    Object.assign(this.data, patch)
  }
  o.lifetimes.attached.call(c)
  return c
}

beforeEach(() => {
  vi.useFakeTimers()
  ;(globalThis as any).wx = { getWindowInfo: () => ({ windowWidth: 375, windowHeight: 667, pixelRatio: 2 }) }
})
afterEach(() => vi.useRealTimers())

describe('自绘提示与加载', () => {
  it('大白话：成功提示带像素 ✓、1.5 秒后收；mask 期间挡住点按', async () => {
    const c = mount(await load())
    c.toast('已保存', true, 1500, true)
    expect(c.data).toMatchObject({ toastShow: true, toastKind: 'ok', toastText: '已保存', blocking: true })
    vi.advanceTimersByTime(1500)
    expect(c.data).toMatchObject({ toastShow: false, blocking: false })
  })
  it('大白话：提示期间换页——新露面那页接着显示剩下的时长（替原生「跨页不断」：保存后随即返回也看得到）', async () => {
    const o = await load()
    const a = mount(o)
    a.toast('已保存', true)
    vi.advanceTimersByTime(500)
    const b = mount(o) // 跳到新页（attached 认领）
    expect(b.data).toMatchObject({ toastShow: true, toastKind: 'ok', toastText: '已保存' })
    vi.advanceTimersByTime(1000)
    expect(b.data.toastShow).toBe(false)
    const c = mount(o) // 已过时：不再接
    expect(c.data.toastShow).toBe(false)
  })
  it('大白话：加载框——像素转圈、挡点按，直到收起；收起不影响别的提示', async () => {
    const c = mount(await load())
    c.loading('提交中')
    expect(c.data).toMatchObject({ toastShow: true, toastKind: 'loading', blocking: true })
    vi.advanceTimersByTime(10000)
    expect(c.data.toastShow).toBe(true) // 不会自己消失
    c.loaded()
    expect(c.data).toMatchObject({ toastShow: false, blocking: false })
    c.toast('好了')
    c.loaded()
    expect(c.data.toastShow).toBe(true)
  })
})

describe('确认半屏（替原生 showModal）', () => {
  it('大白话：普通确认——点右边墨黑键＝确认，点左键或遮罩＝取消', async () => {
    const c = mount(await load())
    const p1 = c.confirm({ title: '确认收货', confirmText: '确认收货' })
    expect(c.data.cf).toMatchObject({ title: '确认收货', confirmText: '确认收货', cancelText: '取消' })
    c.onCfYes()
    vi.advanceTimersByTime(240)
    await expect(p1).resolves.toBe(true)
    expect(c.data.cf).toBeNull()
    const p2 = c.confirm({ title: '确认收货' })
    c.onCfMask()
    vi.advanceTimersByTime(240)
    await expect(p2).resolves.toBe(false)
  })
  it('大白话：只一颗「知道了」的通知——点遮罩也算知道了', async () => {
    const c = mount(await load())
    const p = c.confirm({ title: '订单已关闭', confirmText: '知道了', single: true })
    c.onCfMask()
    vi.advanceTimersByTime(240)
    await expect(p).resolves.toBe(true)
  })
  it('大白话：危险确认——按住 700ms 才执行；松手太快只提示「按住删除」、不执行；手指滑开作废', async () => {
    const c = mount(await load())
    const p = c.confirm({ title: '删除个人资料', confirmText: '删除', cancelText: '保留', danger: true })
    const touch = (x: number) => ({ touches: [{ clientX: x, clientY: 0 }] })
    c.onCfHoldStart(touch(0))
    vi.advanceTimersByTime(200)
    c.onCfHoldEnd()
    expect(c.data.cf).not.toBeNull()
    expect(c.data.toastText).toBe('按住删除')
    c.onCfHoldStart(touch(0))
    c.onCfHoldMove(touch(30))
    vi.advanceTimersByTime(800)
    expect(c.data.cf).not.toBeNull()
    c.onCfHoldStart(touch(0))
    expect(c.data.cfHold).toBe(true)
    vi.advanceTimersByTime(700 + 240)
    await expect(p).resolves.toBe(true)
  })
  it('大白话：页面带着没答的确认半屏卸掉＝当取消（调用方不会永远等着）', async () => {
    const o = await load()
    const c = mount(o)
    const p = c.confirm({ title: '确认收货' })
    o.lifetimes.detached.call(c)
    await expect(p).resolves.toBe(false)
  })
})

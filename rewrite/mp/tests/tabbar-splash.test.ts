// 开屏与底部 TabBar 的交接（老板真机 2026-10-02「tabbar 在启动时加载慢了，首页下面漏出来一下」）：
// 原先开屏淡出 500ms 期间 TabBar 一直藏着、淡完才回来——首页已透出、底部空着；开屏刚出来时 TabBar 还先盖在开屏上闪一下。
// 改为：开屏在场时 TabBar 挂上即藏好；开屏一开始淡出，TabBar 同步淡入（500ms），底部不留空。
// Component 桩同 g2-me-sheets-v5.test.ts；两组件在同一份模块实例里挂（共享开屏在场标记）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import barWxml from '../custom-tab-bar/index.wxml?raw'
import barWxss from '../custom-tab-bar/index.wxss?raw'

vi.mock('../lib/keyFx', () => ({ keyDown: vi.fn(), keyUp: vi.fn(), keyPress: vi.fn() }))

let opts: Record<string, any> = {}
;(globalThis as any).Component = (o: unknown) => {
  opts = o as Record<string, any>
}

function make(o: Record<string, any>): Record<string, any> {
  const c: Record<string, any> = { data: { ...o.data }, properties: {}, ...o.methods }
  c.setData = function (patch: Record<string, unknown>) {
    Object.assign(this.data, patch)
  }
  return c
}

let splashOpts: Record<string, any>
let barOpts: Record<string, any>
beforeEach(async () => {
  vi.useFakeTimers()
  ;(globalThis as any).wx = { getStorageSync: () => undefined, setStorageSync: vi.fn(), removeStorageSync: vi.fn() }
  ;(globalThis as any).getCurrentPages = () => [{}]
  vi.resetModules()
  await import('../components/brand-splash/brand-splash')
  splashOpts = opts
  await import('../custom-tab-bar/index')
  barOpts = opts
})
afterEach(() => vi.useRealTimers())

function mountSplash(bar: Record<string, any> | null) {
  const s = make(splashOpts)
  s.properties = { ready: false }
  s.selectOwnerComponent = () => ({ getTabBar: () => bar })
  s.triggerEvent = vi.fn()
  splashOpts.lifetimes.attached.call(s)
  splashOpts.lifetimes.ready?.call(s)
  return s
}
function mountBar() {
  const b = make(barOpts)
  barOpts.lifetimes.attached.call(b)
  return b
}

describe('开屏与 TabBar 交接', () => {
  it('大白话：开屏先出来、TabBar 后挂上——TabBar 一挂上就是藏着的，不在开屏上闪一下', () => {
    mountSplash(null) // 开屏挂上时 TabBar 还没有
    const bar = mountBar()
    expect(bar.data.hidden).toBe(true)
  })

  it('大白话：TabBar 先挂上、开屏后出来——开屏一挂上 TabBar 就让位', () => {
    const bar = mountBar()
    expect(bar.data.hidden).toBe(false)
    mountSplash(bar)
    expect(bar.data.hidden).toBe(true)
  })

  it('大白话：开屏一开始淡出，TabBar 当场回来并跟着淡入；不等 500ms 淡完（淡出期间首页已透出，底部不能空着）', () => {
    const bar = mountBar()
    const s = mountSplash(bar)
    s.leave()
    expect(bar.data).toMatchObject({ hidden: false, fadeIn: true })
    expect(s.triggerEvent).not.toHaveBeenCalled()
    vi.advanceTimersByTime(500)
    expect(s.triggerEvent).toHaveBeenCalledWith('done')
    expect(bar.data.hidden).toBe(false)
    // 开屏撤了以后新挂的 TabBar（切到购物车/我页）照常显示、不淡入
    const later = mountBar()
    expect(later.data).toMatchObject({ hidden: false, fadeIn: false })
  })

  it('大白话：开屏期间切到了别的页（那页 TabBar 挂上时被藏）——开屏一撤它也回来，不卡在没有 TabBar 的页上（老板真机 2026-10-02「切换时消失、只能刷新」）', () => {
    const homeBar = mountBar()
    const s = mountSplash(homeBar)
    const cartBar = mountBar() // 开屏还在时切到购物车
    expect(cartBar.data.hidden).toBe(true)
    s.leave()
    expect(cartBar.data.hidden).toBe(false)
    expect(homeBar.data.hidden).toBe(false)
  })

  it('大白话：页面每次露面 TabBar 都按当下开关重算——哪个开关漏了通知，切过来也不会一直藏着', () => {
    const bar = mountBar()
    bar.setData({ hidden: true }) // 模拟某个开关变回 0 时没通知到本实例
    barOpts.pageLifetimes.show.call(bar)
    expect(bar.data.hidden).toBe(false)
  })

  it('大白话：转场遮罩撤了 TabBar 直接回来，不淡入（淡入只给开屏交接用）', () => {
    const bar = mountBar()
    bar.setCovered(true)
    expect(bar.data.hidden).toBe(true)
    bar.setCovered(false)
    expect(bar.data).toMatchObject({ hidden: false, fadeIn: false })
  })

  it('大白话：淡入挂在 TabBar 根节点上，时长 500ms 与开屏淡出一致', () => {
    expect(barWxml).toContain(`class="v5-scope ld-tabbar {{fadeIn ? 'ld-tab-in' : ''}}"`)
    expect(barWxss).toMatch(/\.ld-tab-in\s*\{[^}]*animation:\s*ld-tab-in 500ms/)
  })
})

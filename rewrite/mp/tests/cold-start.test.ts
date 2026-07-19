// 冷启动耗时上报（R41·守卫 rw-mp-funnel-tracked）：markLaunch 记起点 + reportColdStart 算 delta 上报一次
// （home 首帧 onReady 触点·仅首次——onReady 生命周期本身只触发一次+内部 reported 锁双保险）。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const trackEvent = vi.fn()
vi.mock('../api/learning', () => ({ trackEvent: (...args: unknown[]) => trackEvent(...args) }))

import { markLaunch, reportColdStart, __resetForTest } from '../lib/coldStart'

beforeEach(() => {
  trackEvent.mockClear()
  __resetForTest()
})

describe('冷启动耗时上报（R41）', () => {
  it('大白话：记了起点后首次上报会算出耗时毫秒数、事件打到 home 页；未记起点直接上报则静默不发', () => {
    reportColdStart() // 未 markLaunch 先调——不应上报（launchAt=0）
    expect(trackEvent).not.toHaveBeenCalled()

    markLaunch()
    reportColdStart()
    expect(trackEvent).toHaveBeenCalledTimes(1)
    expect(trackEvent).toHaveBeenCalledWith('cold_start', 'home', '', { ms: expect.any(Number) })
  })

  it('大白话：同一次冷启动内重复调用只上报一次（防切 tab 回来/意外重触发导致同一次启动算两条数）', () => {
    markLaunch()
    reportColdStart()
    reportColdStart()
    reportColdStart()
    expect(trackEvent).toHaveBeenCalledTimes(1)
  })

  it('重置后新一轮冷启动可以再上报一次（__resetForTest 隔离用例，同 cart/checkout 范式）', () => {
    markLaunch()
    reportColdStart()
    expect(trackEvent).toHaveBeenCalledTimes(1)
    __resetForTest()
    markLaunch()
    reportColdStart()
    expect(trackEvent).toHaveBeenCalledTimes(2)
  })
})

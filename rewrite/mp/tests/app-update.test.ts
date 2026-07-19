// 强制更新接线（R41·守卫 rw-mp-funnel-tracked）：wx.getUpdateManager 三分支——基础库过低静默跳过 /
// 新版本就绪弹确认框（带「稍后」取消项）只有用户点确认才 applyUpdate / 下载失败提示删除重装。
import { describe, it, expect, vi, afterEach } from 'vitest'
import { checkForUpdate } from '../utils/appUpdate'

afterEach(() => {
  delete (globalThis as any).wx
})

describe('强制更新接线（R41）', () => {
  it('大白话：基础库过低（无 getUpdateManager）时静默跳过，不报错也不弹窗', () => {
    ;(globalThis as any).wx = {}
    expect(() => checkForUpdate()).not.toThrow()
  })

  it('大白话：新版本准备好会弹确认框，用户点「立即重启」才真的重启（带「稍后」取消项，不强制打断结算/支付中的用户）', () => {
    let readyCb: (() => void) | undefined
    const applyUpdate = vi.fn()
    const showModal = vi.fn((opt: any) => {
      // 模拟用户点了确认
      opt.success?.({ confirm: true, cancel: false })
    })
    ;(globalThis as any).wx = {
      getUpdateManager: () => ({
        onCheckForUpdate: () => undefined,
        onUpdateReady: (cb: () => void) => {
          readyCb = cb
        },
        onUpdateFailed: () => undefined,
        applyUpdate,
      }),
      showModal,
    }
    checkForUpdate()
    readyCb?.()
    expect(showModal).toHaveBeenCalledTimes(1)
    const opt = showModal.mock.calls[0][0]
    expect(opt.showCancel).toBe(true) // 必须带取消项——用户可能正结算/支付中途，不强制打断
    expect(applyUpdate).toHaveBeenCalledTimes(1)
  })

  it('大白话：用户点「稍后」不重启，只是先不打断当前操作', () => {
    let readyCb: (() => void) | undefined
    const applyUpdate = vi.fn()
    const showModal = vi.fn((opt: any) => {
      opt.success?.({ confirm: false, cancel: true }) // 模拟用户点了「稍后」
    })
    ;(globalThis as any).wx = {
      getUpdateManager: () => ({
        onCheckForUpdate: () => undefined,
        onUpdateReady: (cb: () => void) => {
          readyCb = cb
        },
        onUpdateFailed: () => undefined,
        applyUpdate,
      }),
      showModal,
    }
    checkForUpdate()
    readyCb?.()
    expect(applyUpdate).not.toHaveBeenCalled()
  })

  it('大白话：下载失败会提示删除小程序重装，且不会去调 applyUpdate（没有可用的新版本可重启）', () => {
    let failedCb: (() => void) | undefined
    const applyUpdate = vi.fn()
    const showModal = vi.fn()
    ;(globalThis as any).wx = {
      getUpdateManager: () => ({
        onCheckForUpdate: () => undefined,
        onUpdateReady: () => undefined,
        onUpdateFailed: (cb: () => void) => {
          failedCb = cb
        },
        applyUpdate,
      }),
      showModal,
    }
    checkForUpdate()
    failedCb?.()
    expect(showModal).toHaveBeenCalledTimes(1)
    expect(String(showModal.mock.calls[0][0].title)).toContain('更新失败')
    expect(applyUpdate).not.toHaveBeenCalled()
  })
})

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  privacySheetVisible,
  openPrivacyGate,
  agreePrivacy,
  disagreePrivacy,
  registerPrivacyGate,
} from '@/composables/usePrivacyGate.js'

// 隐私授权闸纯状态逻辑（R27㉒）：开关切换 + resolve 落地 + 只回调一次。
// 真机/微信接口行为靠人验（根因#8），此处只锁可机器验的核心逻辑。
// privacySheetVisible 是模块级单例，跨用例重置；wx 是端私有，跨用例清。
beforeEach(() => {
  privacySheetVisible.value = false
  delete globalThis.wx
})

describe('usePrivacyGate · 隐私授权闸（状态逻辑）', () => {
  it('触发授权：打开弹窗、记住 resolve（先不放行）', () => {
    const resolve = vi.fn()
    openPrivacyGate(resolve)
    expect(privacySheetVisible.value).toBe(true)
    expect(resolve).not.toHaveBeenCalled()
  })

  it('同意：关弹窗 + 以 agree 放行（带按钮 id）', () => {
    const resolve = vi.fn()
    openPrivacyGate(resolve)
    agreePrivacy('privacy-agree-btn')
    expect(privacySheetVisible.value).toBe(false)
    expect(resolve).toHaveBeenCalledWith({ buttonId: 'privacy-agree-btn', event: 'agree' })
  })

  it('不同意：关弹窗 + 以 disagree 中止', () => {
    const resolve = vi.fn()
    openPrivacyGate(resolve)
    disagreePrivacy()
    expect(privacySheetVisible.value).toBe(false)
    expect(resolve).toHaveBeenCalledWith({ event: 'disagree' })
  })

  it('resolve 只回调一次：同意后重复点不再放行', () => {
    const resolve = vi.fn()
    openPrivacyGate(resolve)
    agreePrivacy()
    agreePrivacy()
    disagreePrivacy()
    expect(resolve).toHaveBeenCalledTimes(1)
  })

  it('registerPrivacyGate：挂上 onNeedPrivacyAuthorization，微信触发即开弹窗', () => {
    let captured = null
    globalThis.wx = {
      onNeedPrivacyAuthorization: (cb) => {
        captured = cb
      },
    }
    registerPrivacyGate()
    expect(typeof captured).toBe('function')
    const resolve = vi.fn()
    captured(resolve) // 模拟微信触发
    expect(privacySheetVisible.value).toBe(true)
  })

  it('无 wx（H5 / App / Node）：registerPrivacyGate 安全空转', () => {
    expect(() => registerPrivacyGate()).not.toThrow()
    expect(privacySheetVisible.value).toBe(false)
  })
})

import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useUserStore } from '@/store/user.js'
import { ensureLogin, loginSheetVisible } from '@/composables/useAuthGate.js'

// 软门槛：已登录放行；未登录打开登录半屏弹窗（loginSheetVisible，不跳页）。
// loginSheetVisible 是模块级单例，跨用例重置。
beforeEach(() => {
  setActivePinia(createPinia())
  loginSheetVisible.value = false
})

describe('ensureLogin · 软门槛（半屏弹窗）', () => {
  it('已登录：放行返回 true、不弹登录', () => {
    const user = useUserStore()
    user.token = 'oTEST' // isLogin 转真
    expect(ensureLogin()).toBe(true)
    expect(loginSheetVisible.value).toBe(false)
  })

  it('未登录：拦截返回 false、打开登录弹窗', () => {
    expect(ensureLogin()).toBe(false)
    expect(loginSheetVisible.value).toBe(true)
  })
})

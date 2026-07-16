// 登录软门槛 loginGate（R1·规格§四-1）——旧线 packages/miniapp/tests/auth.test.js 原生 mp 移植。
// ensureLogin：已同意（本地 hint=true）放行返回 true 不弹；未同意拦截返回 false 并打开半屏。
// hint sanitize：storage 不可信只认字面 true。markAgreed 写 hint + 关闭 + 广播订阅者。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

let store: Record<string, unknown> = {}
beforeEach(() => {
  store = {}
  ;(globalThis as any).wx = {
    getStorageSync: (k: string) => store[k],
    setStorageSync: (k: string, v: unknown) => {
      store[k] = v
    },
  }
})
afterEach(() => {
  delete (globalThis as any).wx
})

describe('loginGate · 登录软门槛（半屏弹窗·R1）', () => {
  it('大白话：未同意→ensureLogin 拦截返回 false 并打开半屏；已同意→放行 true 不弹', async () => {
    const { createLoginGate } = await import('../lib/loginGate')
    const gate = createLoginGate()
    expect(gate.hasAgreed()).toBe(false)
    expect(gate.ensureLogin()).toBe(false)
    expect(gate.visible()).toBe(true)

    store['ld_login_hint'] = true
    const gate2 = createLoginGate()
    expect(gate2.ensureLogin()).toBe(true)
    expect(gate2.visible()).toBe(false)
  })

  it('大白话：markAgreed 写本地 hint 并关闭；订阅者收到开关广播 [开, 关]', async () => {
    const { createLoginGate } = await import('../lib/loginGate')
    const gate = createLoginGate()
    const seen: boolean[] = []
    gate.subscribe((v) => seen.push(v))
    gate.open()
    expect(gate.visible()).toBe(true)
    gate.markAgreed()
    expect(store['ld_login_hint']).toBe(true)
    expect(gate.visible()).toBe(false)
    expect(seen).toEqual([true, false])
  })

  it('大白话：logout 清本地 hint 使 hasAgreed 转假、ensureLogin 重新拦截（登出态）', async () => {
    const { createLoginGate } = await import('../lib/loginGate')
    store['ld_login_hint'] = true
    const gate = createLoginGate()
    expect(gate.hasAgreed()).toBe(true)
    expect(gate.ensureLogin()).toBe(true)
    gate.logout()
    expect(store['ld_login_hint']).toBe(false)
    expect(gate.hasAgreed()).toBe(false)
    expect(gate.visible()).toBe(false)
    expect(gate.ensureLogin()).toBe(false) // 退出后再触发软门槛又拦
  })

  it('大白话：hint sanitize storage 不可信——只认字面 true', async () => {
    const { sanitizeLoginHint } = await import('../lib/loginGate')
    expect(sanitizeLoginHint(true)).toBe(true)
    expect(sanitizeLoginHint('true')).toBe(false)
    expect(sanitizeLoginHint(1)).toBe(false)
    expect(sanitizeLoginHint(undefined)).toBe(false)
    expect(sanitizeLoginHint(null)).toBe(false)
  })
})

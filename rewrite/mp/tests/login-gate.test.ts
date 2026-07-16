// 登录软门槛 loginGate（R1·规格§四-1）——旧线 packages/miniapp/tests/auth.test.js 原生 mp 移植。
// ensureLogin：已同意（本地 hint=true）放行返回 true 不弹；未同意拦截返回 false 并打开半屏。
// hint sanitize：storage 不可信只认字面 true。markAgreed 写 hint + 关闭 + 广播订阅者。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import homeWxml from '../pages/home/home.wxml?raw'
import meWxml from '../pages/me/me.wxml?raw'
import tabbarTs from '../custom-tab-bar/index.ts?raw'
import tabbarWxml from '../custom-tab-bar/index.wxml?raw'

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

  it('大白话：maybePromptOnce 本会话至多弹一次——首个未同意页弹、其余页不再弹；已同意不弹', async () => {
    const { createLoginGate } = await import('../lib/loginGate')
    const gate = createLoginGate()
    gate.maybePromptOnce()
    expect(gate.visible()).toBe(true) // 未同意 → 弹
    gate.close()
    gate.maybePromptOnce()
    expect(gate.visible()).toBe(false) // 本会话已弹过 → 不再弹

    store['ld_login_hint'] = true
    const gate2 = createLoginGate()
    gate2.maybePromptOnce()
    expect(gate2.visible()).toBe(false) // 已同意 → 不弹
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

// 接线回归锁（守 2026-07-16 真机反馈两 bug：①登录半屏也要在首页出现 ②tabBar 覆盖半屏）
describe('登录半屏接线（防两报告 bug 回归·R1）', () => {
  it('大白话：首页与我页都挂了 <login-sheet>（软门槛在首页也出现·非只我页）', () => {
    expect(homeWxml).toContain('<login-sheet')
    expect(meWxml).toContain('<login-sheet')
  })
  it('大白话：自定义 tabBar 订阅 loginGate 并按 hidden 让位（半屏打开时不盖住登录·页面 z-index 盖不住原生 tabBar 层）', () => {
    expect(tabbarTs).toContain("from '../lib/loginGate'")
    expect(tabbarTs).toContain('loginGate.subscribe')
    expect(tabbarWxml).toContain('!hidden')
  })
})

// 数据共享授权「登录即默认开启、可随时撤回」（老板 2026-09-30·决策记录 §40）——小程序半边：
// 登录接口带「已同意协议」标记（只有勾过协议才带 true）；登录半屏告知默认开启；授权页只放一颗键：
// 服务端确认已撤回＝「重新开启」，其余（已开启/未知/拉取失败）一律「撤回授权」——任何时候都能撤回。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import loginSheetWxml from '../components/login-sheet/login-sheet.wxml?raw'
import loginSheetTs from '../components/login-sheet/login-sheet.ts?raw'
import meTs from '../pages/me/me.ts?raw'
import peTs from '../pages/profile-edit/profile-edit.ts?raw'
import consentWxml from '../pages/consent/consent.wxml?raw'

const { callAppMock } = vi.hoisted(() => ({ callAppMock: vi.fn() }))
vi.mock('../utils/cloud', () => ({ callApp: callAppMock }))
vi.mock('../lib/haptics', () => ({ tapHaptic: vi.fn() }))

let pageOpts: Record<string, any> = {}
;(globalThis as any).Page = (o: unknown) => {
  pageOpts = o as Record<string, any>
}
let storage: Record<string, unknown>
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}
const live = (w: string) => w.replace(/<!--[\s\S]*?-->/g, '')

beforeEach(() => {
  storage = {}
  callAppMock.mockReset()
  ;(globalThis as any).wx = {
    getStorageSync: (k: string) => storage[k],
    setStorageSync: (k: string, v: unknown) => (storage[k] = v),
    showToast: vi.fn(),
    navigateTo: vi.fn(),
  }
})

async function mountConsent() {
  vi.resetModules()
  await import('../pages/consent/consent')
  const page = Object.create(pageOpts) as Record<string, any>
  page.data = { ...pageOpts.data }
  page.setData = function (patch: Record<string, unknown>) {
    Object.assign(this.data as Record<string, unknown>, patch)
  }
  page.onLoad()
  return page
}

describe('登录带「已同意协议」标记', () => {
  it('大白话：登录接口把标记传给云端；登录半屏（刚勾协议）传 true，「我」页/编辑资料/授权页按本机是否已同意协议传', async () => {
    vi.resetModules()
    callAppMock.mockResolvedValue({ ok: true })
    const { login } = await import('../api/user')
    await login(true)
    expect(callAppMock).toHaveBeenCalledWith('login', { agreed: true })
    expect(loginSheetTs).toMatch(/await login\(true\)/)
    for (const src of [meTs, peTs]) expect(src).toMatch(/login\(loginGate\.hasAgreed\(\)\)/)
  })
  it('大白话：登录半屏协议勾选下方告知「登录即默认开启受托客服数据共享，可随时撤回」', () => {
    expect(live(loginSheetWxml)).toMatch(/<text class="t-sys ls-cs-note">登录即默认开启受托客服数据共享，可随时撤回<\/text>/)
  })
})

describe('授权页只放一颗键：服务端确认已撤回＝重新开启，其余＝撤回授权', () => {
  it('大白话：服务端是「已开启」——撤回授权', async () => {
    callAppMock.mockResolvedValue({ ok: true, user: { csDataShare: { agreed: true } } })
    const page = await mountConsent()
    await flush()
    expect(page.data.serverState).toBe(true)
  })
  it('大白话：服务端确认「已撤回」——重新开启', async () => {
    callAppMock.mockResolvedValue({ ok: true, user: { csDataShare: { agreed: false } } })
    const page = await mountConsent()
    await flush()
    expect(page.data.serverState).toBe(false)
  })
  it('大白话：本机记着「已撤回」但服务端没拉到——仍给「撤回授权」（本机可能过时，宁可让人能撤回）', async () => {
    storage.ld_consent_hint = false
    callAppMock.mockResolvedValue({ ok: false, error: 'CALL_FAIL' })
    const page = await mountConsent()
    await flush()
    expect(page.data.state).toBe(false)
    expect(page.data.serverState).toBe(null)
  })
  it('大白话：点撤回成功后按键换成「重新开启」，点重新开启成功后换回「撤回授权」', async () => {
    callAppMock.mockImplementation(async (a: string) => (a === 'login' ? { ok: true, user: { csDataShare: { agreed: true } } } : { ok: true }))
    const page = await mountConsent()
    await flush()
    await page.submit(false)
    expect(page.data.serverState).toBe(false)
    await page.submit(true)
    expect(page.data.serverState).toBe(true)
  })
  it('大白话：页面只有一颗键，按 serverState 切换；「撤回授权」是轻点、不藏在长按后面', () => {
    const w = live(consentWxml)
    expect(w).toMatch(/<view wx:if="\{\{serverState === false\}\}"[^>]*bind:tap="onAgree"[^>]*>重新开启<\/view>/)
    expect(w).toMatch(/<view wx:else[^>]*bind:tap="onRevoke"[^>]*>撤回授权<\/view>/)
    expect(w).not.toMatch(/同意共享|longpress/)
    expect(w).toContain('你在登录时同意《用户协议》《隐私政策》即默认开启此项授权。你可在本页随时撤回，撤回后外包坐席将无法再查看你的上述数据（不影响此前已依约进行的处理）；撤回后也可以重新开启。')
  })
})

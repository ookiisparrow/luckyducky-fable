// 数据共享授权页行为：进页显示本地提示态、同意/撤回的提交参数与结果、失败不改状态、在途防重、
// 在途退页后服务端已生效的回包仍要记下提示（下次进页才显示对的状态）。
// 只桩云调用（callApp），api/lib/consent 与 storage 用真的。Page 桩同 p-mp-order-page.test.ts。
import consentWxml from '../pages/consent/consent.wxml?raw'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { callAppMock, hapticMock } = vi.hoisted(() => ({ callAppMock: vi.fn(), hapticMock: vi.fn() }))
vi.mock('../utils/cloud', () => ({ callApp: callAppMock }))
vi.mock('../lib/haptics', () => ({ tapHaptic: hapticMock }))

let pageOpts: Record<string, any> = {}
;(globalThis as any).Page = (o: unknown) => {
  pageOpts = o as Record<string, any>
}

const HINT_KEY = 'ld_consent_hint'
let storage: Record<string, unknown>
let wxMock: Record<string, any>
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}

async function mount(): Promise<Record<string, any>> {
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

beforeEach(() => {
  storage = {}
  callAppMock.mockReset().mockResolvedValue({ ok: true })
  hapticMock.mockReset()
  wxMock = {
    getStorageSync: (k: string) => storage[k],
    setStorageSync: (k: string, v: unknown) => (storage[k] = v),
    showToast: vi.fn(),
    navigateTo: vi.fn(),
  }
  ;(globalThis as any).wx = wxMock
})

describe('授权页：进页', () => {
  it('大白话：本机记过「已同意」就显示已同意；没记过或记了乱值都显示「尚未选择」', async () => {
    storage[HINT_KEY] = true
    expect((await mount()).data).toMatchObject({ state: true, stateLabel: '当前状态：已同意共享' })
    storage[HINT_KEY] = false
    expect((await mount()).data).toMatchObject({ state: false, stateLabel: '当前状态：已撤回授权' })
    storage[HINT_KEY] = 'yes'
    expect((await mount()).data).toMatchObject({ state: null, stateLabel: '当前状态：尚未选择' })
  })

  it('大白话：点「查看完整隐私政策」打开隐私政策那一份', async () => {
    const page = await mount()
    page.onPolicy()
    expect(wxMock.navigateTo).toHaveBeenCalledWith({ url: '/pages/agreement/agreement?type=privacy' })
  })
})

describe('授权页：同意 / 撤回', () => {
  it('大白话：点同意——发 agree:true，成功后显示已同意、本机记下、提示已同意', async () => {
    const page = await mount()
    page.onAgree()
    await flush()
    expect(callAppMock).toHaveBeenCalledWith('dataConsent', { agree: true })
    expect(page.data).toMatchObject({ state: true, stateLabel: '当前状态：已同意共享' })
    expect(storage[HINT_KEY]).toBe(true)
    expect(wxMock.showToast).toHaveBeenCalledWith({ title: '已同意数据共享', icon: 'none' })
    expect(hapticMock).toHaveBeenCalledTimes(1)
  })

  it('大白话：点撤回——发 agree:false，成功后显示已撤回', async () => {
    storage[HINT_KEY] = true
    const page = await mount()
    page.onRevoke()
    await flush()
    expect(callAppMock).toHaveBeenCalledWith('dataConsent', { agree: false })
    expect(page.data).toMatchObject({ state: false, stateLabel: '当前状态：已撤回授权', busy: false })
    expect(storage[HINT_KEY]).toBe(false)
    expect(wxMock.showToast).toHaveBeenCalledWith({ title: '已撤回授权', icon: 'none' })
  })

  it('大白话：服务器没答应——状态不动、本机提示不改，告诉用户稍后重试，按钮恢复可点', async () => {
    storage[HINT_KEY] = true
    callAppMock.mockResolvedValue({ ok: false, error: 'CALL_TIMEOUT' })
    const page = await mount()
    page.onRevoke()
    await flush()
    expect(page.data).toMatchObject({ state: true, stateLabel: '当前状态：已同意共享', busy: false })
    expect(storage[HINT_KEY]).toBe(true)
    expect(wxMock.showToast).toHaveBeenCalledWith({ title: '操作失败，请稍后重试', icon: 'none' })
  })

  it('大白话：提交还没回来时再点同意或撤回——不重复发请求，也不再震', async () => {
    let release!: (v: unknown) => void
    callAppMock.mockImplementation(() => new Promise((r) => (release = r)))
    const page = await mount()
    const first = page.submit(true)
    page.onAgree()
    page.onRevoke()
    expect(callAppMock).toHaveBeenCalledTimes(1)
    expect(hapticMock).not.toHaveBeenCalled()
    release({ ok: true })
    await first
    expect(page.data.state).toBe(true)
  })

  it('大白话：提交在途就退出了页面，服务器其实已经撤回——不再弹提示，但本机要记下，下次进来显示「已撤回」', async () => {
    storage[HINT_KEY] = true
    let release!: (v: unknown) => void
    callAppMock.mockImplementation(() => new Promise((r) => (release = r)))
    const page = await mount()
    const pending = page.submit(false)
    page.onUnload()
    release({ ok: true })
    await pending
    expect(wxMock.showToast).not.toHaveBeenCalled()
    expect(page.data.state).toBe(true)
    expect((await mount()).data).toMatchObject({ state: false, stateLabel: '当前状态：已撤回授权' })
  })
})

describe('授权页：撤回与同意一样便捷（合规·个人信息保护法）', () => {
  it('大白话：「撤回授权」是轻点就撤、不藏在任何条件后面；「同意共享」同样常驻', () => {
    const live = consentWxml.replace(/<!--[\s\S]*?-->/g, '')
    const revoke = live.match(/<view[^>]*bind:tap="onRevoke"[^>]*>/)
    expect(revoke, '撤回键要用 bind:tap 轻点触发').not.toBeNull()
    expect(revoke![0]).not.toMatch(/wx:if|wx:elif|wx:else|touchstart|longpress/)
    const agree = live.match(/<view[^>]*bind:tap="onAgree"[^>]*>/)
    expect(agree).not.toBeNull()
    expect(agree![0]).not.toMatch(/wx:if|wx:elif|wx:else/)
  })
})

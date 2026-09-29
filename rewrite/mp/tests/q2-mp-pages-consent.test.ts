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
    ;(globalThis as any).getCurrentPages = () => [{}, {}]
    page.onPolicy()
    expect(wxMock.navigateTo).toHaveBeenCalledWith(expect.objectContaining({ url: '/pages/agreement/agreement?type=privacy' }))
  })

  it('大白话：进页以服务端为准——换过手机/删过资料，本机记的旧状态会被服务端的纠正；服务端没记录＝尚未选择', async () => {
    storage[HINT_KEY] = true
    callAppMock.mockResolvedValue({ ok: true, user: { csDataShare: { agreed: false, at: 1 } } })
    const page = await mount()
    await flush()
    expect(page.data).toMatchObject({ state: false, stateLabel: '当前状态：已撤回授权' })
    expect(storage[HINT_KEY]).toBe(false)

    callAppMock.mockResolvedValue({ ok: true, user: { nickname: '' } })
    const fresh = await mount()
    await flush()
    expect(fresh.data.state).toBeNull()
    expect(storage[HINT_KEY]).toBeNull()
  })

  it('大白话：服务端没拉到——保留本机提示，不把失败当成「尚未选择」；已经点过同意/撤回的，晚到的读结果不覆盖', async () => {
    storage[HINT_KEY] = true
    callAppMock.mockResolvedValue({ ok: false, error: 'CALL_FAIL' })
    const page = await mount()
    await flush()
    expect(page.data.state).toBe(true)

    let releaseLogin!: (v: unknown) => void
    callAppMock.mockImplementation((name: string) =>
      name === 'login' ? new Promise((r) => (releaseLogin = r)) : Promise.resolve({ ok: true })
    )
    const p2 = await mount()
    p2.onRevoke()
    await flush()
    releaseLogin({ ok: true, user: { csDataShare: { agreed: true } } })
    await flush()
    expect(p2.data.state).toBe(false)
  })

  it('大白话：页底有「联系客服」入口', () => {
    expect(consentWxml).toMatch(/bind:tap="onKefu"[\s\S]*联系客服/)
  })
})

describe('授权页：同意 / 撤回', () => {
  it('大白话：点重新开启——发 agree:true，成功后显示已同意、本机记下、提示已重新开启', async () => {
    const page = await mount()
    page.onAgree()
    await flush()
    expect(callAppMock).toHaveBeenCalledWith('dataConsent', { agree: true })
    expect(page.data).toMatchObject({ state: true, stateLabel: '当前状态：已同意共享' })
    expect(storage[HINT_KEY]).toBe(true)
    expect(wxMock.showToast).toHaveBeenCalledWith({ title: '已重新开启', icon: 'success' }) // 页面挂 px-fx 时走自绘 ✓；测试桩没挂退回原生
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
    expect(wxMock.showToast).toHaveBeenCalledWith({ title: '已撤回授权', icon: 'success' })
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
    expect(callAppMock.mock.calls.filter((c) => c[0] === 'dataConsent')).toHaveLength(1)
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

// 「撤回任何时候都点得到」的约束（原两键常驻）改由 consent-default-0930.test.ts 钉：
// 老板 2026-09-30 定只放一颗键，服务端确认已撤回才换「重新开启」，其余一律「撤回授权」（决策记录 §40）。

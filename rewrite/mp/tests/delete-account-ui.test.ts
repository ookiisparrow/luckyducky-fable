// 退出登录 / 删除资料（v5 D3·老板拍板放编辑资料页）：退出＝按住 0.6s；删除＝按住 0.9s 再弹一次后果确认才真删
// （删除不可恢复·隐私政策第六条；按住是设计稿交互，确认框讲清后果）。删成清本地地址、登录态、继续学习旧卡；删失败什么都不清。
// 「我」页不再放这两个入口。Page 桩同 me-cont-failed.test.ts。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import meWxml from '../pages/me/me.wxml?raw'
import peWxml from '../pages/profile-edit/profile-edit.wxml?raw'

const { deleteAccountMock } = vi.hoisted(() => ({ deleteAccountMock: vi.fn() }))
vi.mock('../api/user', () => ({
  login: vi.fn().mockResolvedValue({ ok: true, user: { nickname: '鸭', avatar: '', phone: '' } }),
  updateProfile: vi.fn(),
  deleteAccount: deleteAccountMock,
}))

let pageOpts: Record<string, any> = {}
;(globalThis as any).Page = (o: unknown) => {
  pageOpts = o as Record<string, any>
}

let store: Record<string, unknown> = {}
let wxMock: Record<string, any>
beforeEach(() => {
  vi.useFakeTimers()
  store = { 'ld:me-cont': { courseId: 'c1', lessonId: 'l1' }, ld_consent_hint: true }
  wxMock = {
    getStorageSync: (k: string) => store[k],
    setStorageSync: (k: string, v: unknown) => (store[k] = JSON.parse(JSON.stringify(v))),
    removeStorageSync: (k: string) => delete store[k],
    getWindowInfo: () => ({ statusBarHeight: 20 }),
    showModal: vi.fn(),
    showLoading: vi.fn(),
    hideLoading: vi.fn(),
    showToast: vi.fn(),
    navigateBack: vi.fn(),
    switchTab: vi.fn(),
  }
  ;(globalThis as any).wx = wxMock
  ;(globalThis as any).getCurrentPages = () => [{}, {}]
  deleteAccountMock.mockReset()
})
afterEach(() => vi.useRealTimers())

async function mountLoggedIn() {
  vi.resetModules()
  const { loginGate } = await import('../lib/loginGate')
  const address = await import('../lib/address')
  loginGate.markAgreed()
  address.saveAddress({ name: '鸭', phone: '13800000000', region: '上海', detail: '1 号', isDefault: true })
  await import('../pages/profile-edit/profile-edit')
  const page = Object.create(pageOpts) as Record<string, any>
  page.data = { ...pageOpts.data }
  page.setData = function (patch: Record<string, unknown>, cb?: () => void) {
    Object.assign(this.data as Record<string, unknown>, patch)
    cb?.() // 真运行时渲染落地后回调（退出/删除先撤放弃确认拦截再返回）
  }
  await page.onLoad()
  return { page, loginGate, address }
}

describe('入口位置', () => {
  it('大白话：「我」页没有退出登录/删除资料；编辑资料页有，且用按住（touchstart/touchend）触发、不是轻点', () => {
    const me = meWxml.replace(/<!--[\s\S]*?-->/g, '')
    expect(me).not.toContain('删除资料')
    expect(me).not.toContain('退出登录')
    const pe = peWxml.replace(/<!--[\s\S]*?-->/g, '')
    expect(pe).toContain('删除资料')
    expect(pe).toContain('退出登录')
    expect(pe).toMatch(/touchstart="onDeleteStart"/)
    expect(pe).toMatch(/touchstart="onLogoutStart"/)
    expect(pe).not.toMatch(/bind:tap="onDelete/)
  })
})

describe('退出登录（按住 0.6s）', () => {
  it('大白话：按满才退出并回上一页；点一下只提示按住', async () => {
    const { page, loginGate } = await mountLoggedIn()
    page.onLogoutStart({ touches: [{ clientX: 0, clientY: 0 }] })
    vi.advanceTimersByTime(100)
    page.onLogoutEnd()
    expect(loginGate.hasAgreed()).toBe(true)
    expect(wxMock.showToast).toHaveBeenCalledWith({ title: '按住退出登录', icon: 'none' })
    page.onLogoutStart({ touches: [{ clientX: 0, clientY: 0 }] })
    vi.advanceTimersByTime(600)
    expect(loginGate.hasAgreed()).toBe(false)
    expect(wxMock.navigateBack).toHaveBeenCalledTimes(1)
  })
})

describe('删除资料（按住 0.9s + 一次确认）', () => {
  it('大白话：按满后弹确认；点取消不删', async () => {
    const { page } = await mountLoggedIn()
    page.onDeleteStart({ touches: [{ clientX: 0, clientY: 0 }] })
    vi.advanceTimersByTime(900)
    const m = wxMock.showModal.mock.calls[0][0]
    expect(m.confirmText).toBe('删除')
    expect(m.content).toContain('订单还在')
    m.success({ confirm: false })
    expect(deleteAccountMock).not.toHaveBeenCalled()
  })

  it('大白话：确认后删成——清掉本地地址、登录态、继续学习旧卡，提示已删除并回上一页', async () => {
    const { page, loginGate, address } = await mountLoggedIn()
    deleteAccountMock.mockResolvedValue({ ok: true })
    page.onDeleteStart({ touches: [{ clientX: 0, clientY: 0 }] })
    vi.advanceTimersByTime(900)
    wxMock.showModal.mock.calls[0][0].success({ confirm: true })
    await vi.waitFor(() => expect(wxMock.showToast).toHaveBeenCalledWith({ title: '已删除', icon: 'none' }))
    expect(deleteAccountMock).toHaveBeenCalledTimes(1)
    expect(address.getList()).toEqual([])
    expect(loginGate.hasAgreed()).toBe(false)
    expect(store['ld:me-cont']).toBeUndefined()
    expect(store['ld_consent_hint']).toBeNull() // 服务端已重置数据共享授权：本机旧的「已同意」一并清
    expect(wxMock.navigateBack).toHaveBeenCalledTimes(1)
  })

  it('大白话：确认框的「删除」是警示红；删除在途挂「删除中」遮罩，连点只发一次，回包后收起遮罩', async () => {
    const { page } = await mountLoggedIn()
    page.onDeleteStart({ touches: [{ clientX: 0, clientY: 0 }] })
    vi.advanceTimersByTime(900)
    expect(wxMock.showModal.mock.calls[0][0].confirmColor).toBe('#D9483B')
    let release!: (v: unknown) => void
    deleteAccountMock.mockImplementation(() => new Promise((r) => (release = r)))
    const first = page.runDeleteAccount()
    void page.runDeleteAccount()
    expect(wxMock.showLoading).toHaveBeenCalledWith({ title: '删除中', mask: true })
    expect(deleteAccountMock).toHaveBeenCalledTimes(1)
    expect(wxMock.hideLoading).not.toHaveBeenCalled()
    release({ ok: false })
    await first
    expect(wxMock.hideLoading).toHaveBeenCalledTimes(1)
  })

  it('大白话：按住时手指滑开超过 10px——作废，不弹确认', async () => {
    const { page } = await mountLoggedIn()
    page.onDeleteStart({ touches: [{ clientX: 100, clientY: 100 }] })
    page.onDeleteMove({ touches: [{ clientX: 100, clientY: 120 }] })
    vi.advanceTimersByTime(900)
    expect(wxMock.showModal).not.toHaveBeenCalled()
    page.onLogoutStart({ touches: [{ clientX: 0, clientY: 0 }] })
    page.onLogoutMove({ touches: [{ clientX: 30, clientY: 0 }] })
    vi.advanceTimersByTime(600)
    expect(wxMock.navigateBack).not.toHaveBeenCalled()
  })

  it('大白话：云端没删成——提示稍后再试，地址和登录态都不动', async () => {
    const { page, loginGate, address } = await mountLoggedIn()
    deleteAccountMock.mockResolvedValue({ ok: false, error: 'INTERNAL' })
    await page.runDeleteAccount()
    expect(wxMock.showToast).toHaveBeenCalledWith({ title: '没删成请稍后再试', icon: 'none' })
    expect(address.getList()).toHaveLength(1)
    expect(loginGate.hasAgreed()).toBe(true)
  })
})

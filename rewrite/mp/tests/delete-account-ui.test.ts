// 账号操作（老板 2026-09-30 改）：编辑资料页「删除资料」→「退出登录」（按住 0.6s·只退本机登录态·同一微信再登，资料、
// 课程、进度全回来·本机地址簿也留着）。删除个人资料挪到隐私政策正文末尾（更深的位置）：确认后删，**已解锁课程与学习进度保留**
// （隐私政策第六条·决策记录 §39）。删成清本地地址、登录态、继续学习旧卡、授权提示；删失败什么都不清。Page 桩同 me-cont-failed.test.ts。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import meWxml from '../pages/me/me.wxml?raw'
import peWxml from '../pages/profile-edit/profile-edit.wxml?raw'
import agWxml from '../pages/agreement/agreement.wxml?raw'

const { deleteAccountMock } = vi.hoisted(() => ({ deleteAccountMock: vi.fn() }))
vi.mock('../api/user', () => ({
  login: vi.fn().mockResolvedValue({ ok: true, user: { nickname: '鸭', avatar: '', phone: '' } }),
  updateProfile: vi.fn(),
  deleteAccount: deleteAccountMock,
}))
vi.mock('../lib/pageContent', () => ({ getPageContent: vi.fn().mockResolvedValue(null) }))
vi.mock('../utils/customerService', () => ({ openCustomerService: vi.fn() }))

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
    setNavigationBarTitle: vi.fn(),
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

const live = (w: string) => w.replace(/<!--[\s\S]*?-->/g, '')

async function mount(path: 'profile-edit' | 'agreement', query: Record<string, string> = {}) {
  vi.resetModules()
  const { loginGate } = await import('../lib/loginGate')
  const address = await import('../lib/address')
  loginGate.markAgreed()
  address.saveAddress({ name: '鸭', phone: '13800000000', region: '上海', detail: '1 号', isDefault: true })
  await import(`../pages/${path}/${path}`)
  const page = Object.create(pageOpts) as Record<string, any>
  page.data = { ...pageOpts.data }
  page.setData = function (patch: Record<string, unknown>, cb?: () => void) {
    Object.assign(this.data as Record<string, unknown>, patch)
    cb?.() // 真运行时渲染落地后回调（退出先撤放弃确认拦截再返回）
  }
  await page.onLoad(query)
  return { page, loginGate, address }
}

describe('入口位置', () => {
  it('大白话：「我」页两样都没有；编辑资料页只有「退出登录」（按住触发）；「删除个人资料」只在隐私政策正文末尾', () => {
    const me = live(meWxml)
    expect(me).not.toMatch(/删除资料|删除个人资料|退出登录/)
    const pe = live(peWxml)
    expect(pe).toContain('退出登录')
    expect(pe).not.toMatch(/删除资料|删除个人资料/)
    expect(pe).toMatch(/touchstart="onLogoutStart"/)
    expect(pe).not.toMatch(/bind:tap="onLogout/)
    const ag = live(agWxml)
    expect(ag).toMatch(/<view wx:if="\{\{isPrivacy\}\}" class="ag-row"[^>]*bind:tap="onDeleteData">\s*<text class="ag-row-t ag-danger">删除个人资料<\/text>/)
    expect(ag.indexOf('删除个人资料')).toBeLessThan(ag.indexOf('<view class="ag-dock">')) // 在正文里，不在底部固定栏
  })
})

describe('退出登录（编辑资料页·按住 0.6s）', () => {
  it('大白话：按满就退——只清本机登录态和继续学习旧卡，地址簿和授权提示都留着（同一微信再登全回来），提示后回上一页', async () => {
    const { page, loginGate, address } = await mount('profile-edit')
    page.onLogoutStart({ touches: [{ clientX: 0, clientY: 0 }] })
    vi.advanceTimersByTime(599)
    expect(loginGate.hasAgreed()).toBe(true)
    vi.advanceTimersByTime(1)
    expect(loginGate.hasAgreed()).toBe(false)
    expect(store['ld:me-cont']).toBeUndefined()
    expect(address.getList()).toHaveLength(1)
    expect(store['ld_consent_hint']).toBe(true)
    expect(deleteAccountMock).not.toHaveBeenCalled() // 云端数据一概不动
    expect(wxMock.showToast).toHaveBeenCalledWith({ title: '已退出登录', icon: 'none' })
    expect(wxMock.navigateBack).toHaveBeenCalledTimes(1)
  })

  it('大白话：按住时手指滑开超过 10px——作废，不退', async () => {
    const { page, loginGate } = await mount('profile-edit')
    page.onLogoutStart({ touches: [{ clientX: 100, clientY: 100 }] })
    page.onLogoutMove({ touches: [{ clientX: 100, clientY: 120 }] })
    vi.advanceTimersByTime(600)
    expect(loginGate.hasAgreed()).toBe(true)
  })
})

describe('删除个人资料（隐私政策正文末尾·确认后删·课程与进度保留）', () => {
  it('大白话：点了先弹确认，讲清删什么、课程和进度保留；点取消不删', async () => {
    const { page } = await mount('agreement', { type: 'privacy' })
    page.onDeleteData()
    const m = wxMock.showModal.mock.calls[0][0]
    expect(m.title).toBe('删除个人资料')
    expect(m.content).toContain('已解锁的课程和学习进度会保留')
    expect(m.confirmText).toBe('删除')
    expect(m.cancelText).toBe('保留') // 自绘危险确认：左键红字按住删、右墨黑「保留」（页面桩没挂 px-fx·走原生兜底）
    m.success({ confirm: false })
    await Promise.resolve()
    expect(deleteAccountMock).not.toHaveBeenCalled()
  })

  it('大白话：确认后删成——清掉本地地址、登录态、继续学习旧卡、授权提示，提示已删除', async () => {
    const { page, loginGate, address } = await mount('agreement', { type: 'privacy' })
    deleteAccountMock.mockResolvedValue({ ok: true })
    page.onDeleteData()
    wxMock.showModal.mock.calls[0][0].success({ confirm: true })
    await vi.waitFor(() => expect(wxMock.showToast).toHaveBeenCalledWith({ title: '已删除', icon: 'none' }))
    expect(deleteAccountMock).toHaveBeenCalledTimes(1)
    expect(address.getList()).toEqual([])
    expect(loginGate.hasAgreed()).toBe(false)
    expect(store['ld:me-cont']).toBeUndefined()
    expect(store['ld_consent_hint']).toBeNull()
  })

  it('大白话：删除在途挂「删除中」遮罩，连点只发一次；云端没删成——提示稍后再试，地址和登录态都不动', async () => {
    const { page, loginGate, address } = await mount('agreement', { type: 'privacy' })
    let release!: (v: unknown) => void
    deleteAccountMock.mockImplementation(() => new Promise((r) => (release = r)))
    const first = page.runDeleteData()
    void page.runDeleteData()
    expect(wxMock.showLoading).toHaveBeenCalledWith({ title: '删除中', mask: true })
    expect(deleteAccountMock).toHaveBeenCalledTimes(1)
    release({ ok: false, error: 'INTERNAL' })
    await first
    expect(wxMock.hideLoading).toHaveBeenCalledTimes(1)
    expect(wxMock.showToast).toHaveBeenCalledWith({ title: '没删成，请稍后再试', icon: 'none' })
    expect(address.getList()).toHaveLength(1)
    expect(loginGate.hasAgreed()).toBe(true)
  })
})

// 「我」页删除资料：只在已登录时露出入口；点下去连确认两次才真删，删成清本地地址与登录态，删失败什么都不清。
// 「我」页不用「注销账户」四字（首屏字体没有注/销/账）由守卫 rw-mp-font-tier-subset-covers 管（tier1 缺字即红）。
// Page 桩同 me-cont-failed.test.ts。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import meWxml from '../pages/me/me.wxml?raw'

const { deleteAccountMock } = vi.hoisted(() => ({ deleteAccountMock: vi.fn() }))
vi.mock('../api/user', () => ({
  login: vi.fn().mockResolvedValue({ ok: false }),
  getMyProgress: vi.fn().mockResolvedValue({ ok: false }),
  deleteAccount: deleteAccountMock,
}))
vi.mock('../api/learning', () => ({ getMyCourses: vi.fn().mockResolvedValue({ ok: false }) }))
vi.mock('../lib/courses', () => ({ getCoursesByIds: vi.fn(), getAllCourses: vi.fn() }))
vi.mock('../lib/pageContent', () => ({ getPageContent: vi.fn().mockResolvedValue(null), __resetForTest: () => {} }))

let pageOpts: Record<string, any> = {}
;(globalThis as any).Page = (o: unknown) => {
  pageOpts = o as Record<string, any>
}

let store: Record<string, unknown> = {}
let wxMock: Record<string, any>
beforeEach(() => {
  store = {}
  wxMock = {
    getStorageSync: (k: string) => store[k],
    setStorageSync: (k: string, v: unknown) => (store[k] = JSON.parse(JSON.stringify(v))),
    removeStorageSync: (k: string) => delete store[k],
    getWindowInfo: () => ({ statusBarHeight: 20 }),
    showModal: vi.fn(),
    showToast: vi.fn(),
  }
  ;(globalThis as any).wx = wxMock
  deleteAccountMock.mockReset()
})

async function mountLoggedIn() {
  vi.resetModules()
  const { loginGate } = await import('../lib/loginGate')
  const address = await import('../lib/address')
  loginGate.markAgreed()
  address.saveAddress({ name: '鸭', phone: '13800000000', region: '上海', detail: '1 号', isDefault: true })
  await import('../pages/me/me')
  const page = Object.create(pageOpts) as Record<string, any>
  page.data = { ...pageOpts.data }
  page.setData = function (patch: Record<string, unknown>) {
    Object.assign(this.data as Record<string, unknown>, patch)
  }
  return { page, loginGate, address }
}

const modal = (n: number) => wxMock.showModal.mock.calls[n][0]

describe('删除资料入口（我的页·两次确认）', () => {
  it('大白话：入口只在已登录时露出（wxml 静态标记）', () => {
    const wxml = meWxml.replace(/<!--[\s\S]*?-->/g, '')
    expect(wxml).toContain('删除资料')
    expect(wxml).toMatch(/wx:if="\{\{loggedIn\}\}"[^>]*onDeleteAccount|onDeleteAccount[^>]*wx:if="\{\{loggedIn\}\}"/)
  })

  it('大白话：第一次点「继续」、第二次点「删除」才真删；任一步取消都不删', async () => {
    const { page } = await mountLoggedIn()
    deleteAccountMock.mockResolvedValue({ ok: true })
    page.onDeleteAccount()
    expect(modal(0).confirmText).toBe('继续')
    modal(0).success({ confirm: false })
    expect(wxMock.showModal).toHaveBeenCalledTimes(1)

    modal(0).success({ confirm: true })
    expect(modal(1).confirmText).toBe('删除')
    modal(1).success({ confirm: false })
    expect(deleteAccountMock).not.toHaveBeenCalled()
  })

  it('大白话：两次都确认——删成后清掉本地地址和登录态，提示已删除', async () => {
    const { page, loginGate, address } = await mountLoggedIn()
    deleteAccountMock.mockResolvedValue({ ok: true })
    page.onDeleteAccount()
    modal(0).success({ confirm: true })
    modal(1).success({ confirm: true })
    await vi.waitFor(() => expect(wxMock.showToast).toHaveBeenCalledWith({ title: '已删除', icon: 'none' }))
    expect(deleteAccountMock).toHaveBeenCalledTimes(1)
    expect(address.getList()).toEqual([])
    expect(loginGate.hasAgreed()).toBe(false)
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

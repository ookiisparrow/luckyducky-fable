// 关于我们页：只钉两条合规链接的跳转目标（点「隐私政策」必须打开隐私政策，不能是用户协议）。
// 静态守卫 rw-mp-wxml-handlers-exist 只查处理函数在不在，不查跳到哪。Page 桩同 p-mp-order-page.test.ts。
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../utils/cloud', () => ({ callApp: vi.fn() }))

let pageOpts: Record<string, any> = {}
;(globalThis as any).Page = (o: unknown) => {
  pageOpts = o as Record<string, any>
}

let wxMock: Record<string, any>

beforeEach(() => {
  wxMock = { navigateTo: vi.fn() }
  ;(globalThis as any).wx = wxMock
})

describe('关于我们页', () => {
  it('大白话：点「隐私政策」打开隐私政策，点「用户协议」打开用户协议，不能对调', async () => {
    vi.resetModules()
    await import('../pages/about/about')
    const page = Object.create(pageOpts) as Record<string, any>
    page.onPrivacy()
    page.onUserAgreement()
    expect(wxMock.navigateTo.mock.calls.map((c: any[]) => c[0].url)).toEqual([
      '/pages/agreement/agreement?type=privacy',
      '/pages/agreement/agreement?type=user',
    ])
  })

  it('大白话：页底版本行照设计稿 D5 是「版本号 · 更新 日期」一行，更新日期不能丢', async () => {
    vi.resetModules()
    await import('../pages/about/about')
    const { currentAppVersionLine, DEV_UPDATE_DATE } = await import('../lib/appVersion')
    expect(pageOpts.data.version).toBe(currentAppVersionLine() + ' · 更新 ' + DEV_UPDATE_DATE)
  })
})

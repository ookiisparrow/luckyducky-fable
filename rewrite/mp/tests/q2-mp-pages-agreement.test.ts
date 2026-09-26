// 协议页行为：?type 决定显示用户协议还是隐私政策（导航标题跟着变）、CMS 条款到达后仍停在同一份、
// 拉不到维持默认全文、退页后迟到回包不落、隐私政策才有「管理数据共享授权」入口。
// 只桩云调用（callApp），lib/pageContent 与 mapPages 用真的。Page 桩同 p-mp-order-page.test.ts。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mapAgreement } from '../lib/mapPages'

const { callAppMock } = vi.hoisted(() => ({ callAppMock: vi.fn() }))
vi.mock('../utils/cloud', () => ({ callApp: callAppMock }))

let pageOpts: Record<string, any> = {}
;(globalThis as any).Page = (o: unknown) => {
  pageOpts = o as Record<string, any>
}

let wxMock: Record<string, any>
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}
const DEF = mapAgreement(null)
const CMS = {
  user: { effectiveDate: '2026-09', sections: [{ title: '甲条', body: '用户协议新条款' }] },
  privacy: { effectiveDate: '2026-10', sections: [{ title: '乙条', body: '隐私政策新条款' }] },
}

async function mount(query: Record<string, string> = {}): Promise<Record<string, any>> {
  vi.resetModules()
  await import('../pages/agreement/agreement')
  const page = Object.create(pageOpts) as Record<string, any>
  page.data = { ...pageOpts.data }
  page.setData = function (patch: Record<string, unknown>) {
    Object.assign(this.data as Record<string, unknown>, patch)
  }
  page.onLoad(query)
  return page
}

beforeEach(() => {
  callAppMock.mockReset().mockResolvedValue({ ok: true, content: CMS })
  wxMock = { setNavigationBarTitle: vi.fn(), navigateTo: vi.fn() }
  ;(globalThis as any).wx = wxMock
})

describe('协议页', () => {
  it('大白话：?type=privacy 显示隐私政策（标题「隐私政策」），没带或带别的都显示用户协议', async () => {
    const privacy = await mount({ type: 'privacy' })
    expect(privacy.data.isPrivacy).toBe(true)
    expect(privacy.data.doc.title).toBe('隐私政策')
    expect(wxMock.setNavigationBarTitle).toHaveBeenLastCalledWith({ title: '隐私政策' })
    for (const query of [{}, { type: 'user' }, { type: 'x' }] as Record<string, string>[]) {
      const page = await mount(query)
      expect(page.data.isPrivacy).toBe(false)
      expect(page.data.doc.title).toBe('用户协议')
      expect(wxMock.setNavigationBarTitle).toHaveBeenLastCalledWith({ title: '用户协议' })
    }
  })

  it('大白话：后台改过的条款到了——隐私页换成隐私的新条款，不会被换成用户协议；引言仍是固定合规文本', async () => {
    const page = await mount({ type: 'privacy' })
    await flush()
    expect(callAppMock).toHaveBeenCalledWith('getPageContent', { page: 'agreement' })
    expect(page.data.doc).toMatchObject({ title: '隐私政策', updated: '2026-10', intro: DEF.privacy.intro })
    expect(page.data.doc.articles).toEqual([{ title: '乙条', body: '隐私政策新条款' }])
  })

  it('大白话：后台条款拉不到——保持默认全文，不空屏', async () => {
    callAppMock.mockResolvedValue({ ok: false, error: 'CALL_TIMEOUT' })
    const page = await mount()
    await flush()
    expect(page.data.doc).toEqual(DEF.user)
  })

  it('大白话：条款还没回来就退出了——迟到的内容不再往已退的页上写', async () => {
    let release!: (v: unknown) => void
    callAppMock.mockImplementation(() => new Promise((r) => (release = r)))
    const page = await mount()
    page.onUnload()
    release({ ok: true, content: CMS })
    await flush()
    expect(page.data.doc).toEqual(DEF.user)
  })

  it('大白话：「管理数据共享授权」进授权页', async () => {
    const page = await mount({ type: 'privacy' })
    page.onConsent()
    expect(wxMock.navigateTo).toHaveBeenCalledWith({ url: '/pages/consent/consent' })
  })
})

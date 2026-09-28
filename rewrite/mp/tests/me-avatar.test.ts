// 「我」页点头像直接换微信头像（老板 2026-09-29 拍板 2）：button open-type=chooseAvatar，选完立即上传 + updateProfile({avatar})，
// 不进编辑资料页。上传/审核提示与编辑资料页共用 lib/avatar。未登录时头像不是换头像键——点了打开登录半屏（先登录再换，同「编辑」只给已登录）。
// Page 桩同 q-mp-me-refresh.test.ts；wxml 走 ?raw。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import meWxml from '../pages/me/me.wxml?raw'
import meJson from '../pages/me/me.json?raw'

const { loginMock, updateMock } = vi.hoisted(() => ({ loginMock: vi.fn(), updateMock: vi.fn() }))
vi.mock('../api/user', () => ({
  login: loginMock,
  updateProfile: updateMock,
  getMyProgress: vi.fn().mockResolvedValue({ ok: true, list: [] }),
  deleteAccount: vi.fn(),
}))
vi.mock('../api/learning', () => ({ getMyCourses: vi.fn().mockResolvedValue({ ok: true, list: [] }) }))
vi.mock('../api/orders', () => ({ getMyOrders: vi.fn().mockResolvedValue({ ok: false }) }))
vi.mock('../lib/courses', () => ({ getCoursesByIds: async () => [] }))
vi.mock('../lib/pageContent', () => ({ getPageContent: async () => null }))

let store: Record<string, unknown> = {}
let wxMock: Record<string, any>
beforeEach(() => {
  store = { ld_login_hint: true }
  wxMock = {
    getStorageSync: (k: string) => store[k],
    setStorageSync: (k: string, v: unknown) => (store[k] = v),
    removeStorageSync: (k: string) => delete store[k],
    getWindowInfo: () => ({ statusBarHeight: 20 }),
    showToast: vi.fn(),
    showLoading: vi.fn(),
    hideLoading: vi.fn(),
    navigateTo: vi.fn(),
    cloud: { uploadFile: vi.fn().mockResolvedValue({ fileID: 'cloud://new.png' }) },
  }
  ;(globalThis as any).wx = wxMock
  loginMock.mockReset().mockResolvedValue({ ok: true, user: { nickname: '鸭', avatar: 'cloud://old.png' } })
  updateMock.mockReset()
})

async function mountMe(): Promise<Record<string, any>> {
  let opts: Record<string, any> = {}
  ;(globalThis as any).Page = (o: Record<string, any>) => (opts = o)
  vi.resetModules()
  await import('../pages/me/me')
  const page = Object.create(opts) as Record<string, any>
  page.data = { ...opts.data }
  page.setData = function (patch: Record<string, unknown>) {
    Object.assign(this.data as Record<string, unknown>, patch)
  }
  return page
}

const pick = (url = 'wxfile://tmp.png') => ({ detail: { avatarUrl: url } })
const titles = () => wxMock.showToast.mock.calls.map((c: any[]) => c[0].title)

describe('「我」页头像＝换头像键', () => {
  it('大白话：已登录时头像是 chooseAvatar 能力按钮、带「换」角标；页面挂了隐私弹窗；未登录时点头像去登录', () => {
    const w = meWxml.replace(/<!--[\s\S]*?-->/g, '')
    expect(w).toMatch(/open-type="chooseAvatar"[^>]*bind:chooseavatar="onChooseAvatar"/)
    expect(w).toMatch(/>换</)
    expect(w).toContain('<privacy-sheet')
    expect(meJson).toContain('/components/privacy-sheet/privacy-sheet')
    expect(w).toMatch(/me-av-out[^>]*bind:tap="onLoginTap"|bind:tap="onLoginTap"[^>]*me-av-out/)
  })

  it('大白话：选完立即上传并只存头像，成功提示「头像已更新」、头像当场换成新的、再整页刷新', async () => {
    updateMock.mockResolvedValue({ ok: true, user: { avatar: 'cloud://new.png' } })
    const page = await mountMe()
    const refresh = vi.spyOn(page, 'refresh').mockResolvedValue(undefined)
    await page.onChooseAvatar(pick())
    expect(wxMock.cloud.uploadFile).toHaveBeenCalledWith(expect.objectContaining({ filePath: 'wxfile://tmp.png' }))
    expect(wxMock.cloud.uploadFile.mock.calls[0][0].cloudPath).toMatch(/^avatars\//)
    expect(updateMock).toHaveBeenCalledWith({ avatar: 'cloud://new.png' })
    expect(page.data.avatar).toBe('cloud://new.png')
    expect(titles()).toEqual(['头像已更新'])
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(wxMock.showLoading).toHaveBeenCalledWith(expect.objectContaining({ mask: true }))
    expect(wxMock.hideLoading).toHaveBeenCalledTimes(1)
  })

  it('大白话：审核不过按原因说——违规说换一张；头像没校成也说换一张；其它说稍后再试；头像不变', async () => {
    const cases: [string, string][] = [
      ['IMG_RISKY', '这张头像不能用，换一张'],
      ['SEC_CHECK_FAIL', '头像没通过审核，换一张再试'],
      ['CALL_TIMEOUT', '保存没成功，稍后再试'],
    ]
    for (const [code, tip] of cases) {
      wxMock.showToast = vi.fn()
      updateMock.mockResolvedValueOnce({ ok: false, error: code })
      const page = await mountMe()
      page.data.avatar = 'cloud://old.png'
      await page.onChooseAvatar(pick())
      expect(titles(), code).toEqual([tip])
      expect(page.data.avatar).toBe('cloud://old.png')
      expect(wxMock.hideLoading).toHaveBeenCalled()
    }
  })

  it('大白话：上传没成功——不调保存，提示稍后再试', async () => {
    wxMock.cloud.uploadFile = vi.fn().mockRejectedValue(new Error('net'))
    const page = await mountMe()
    await page.onChooseAvatar(pick())
    expect(updateMock).not.toHaveBeenCalled()
    expect(titles()).toEqual(['头像没传上去，稍后再试'])
    expect(wxMock.hideLoading).toHaveBeenCalledTimes(1)
  })

  it('大白话：保存在途再选一次——不重复上传；回包后才能再换', async () => {
    let release!: (v: unknown) => void
    updateMock.mockImplementation(() => new Promise((r) => (release = r)))
    const page = await mountMe()
    vi.spyOn(page, 'refresh').mockResolvedValue(undefined)
    const first = page.onChooseAvatar(pick('wxfile://a.png'))
    await page.onChooseAvatar(pick('wxfile://b.png'))
    await vi.waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1))
    expect(wxMock.cloud.uploadFile).toHaveBeenCalledTimes(1)
    release({ ok: true, user: { avatar: 'cloud://new.png' } })
    await first
    updateMock.mockResolvedValue({ ok: true, user: { avatar: 'cloud://new.png' } })
    await page.onChooseAvatar(pick('wxfile://c.png'))
    expect(wxMock.cloud.uploadFile).toHaveBeenCalledTimes(2)
  })
})

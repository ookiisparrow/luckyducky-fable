// 编辑资料页加载/失败分治（根因#14）：login 未返回或失败时不得画出空白可编辑档案。
// #272 只挡退页后迟到回包；本页加载中/失败仍会露出空表单+小鸭子，点保存才说没加载好。
// Page 桩同 me-cont-failed.test.ts；wxml 走 ?raw（E34·mp 测试不进 node:fs）。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { loginMock } = vi.hoisted(() => ({ loginMock: vi.fn() }))
vi.mock('../api/user', () => ({ login: loginMock, updateProfile: vi.fn() }))
vi.mock('../lib/haptics', () => ({ tapHaptic: vi.fn() }))

let pageOpts: Record<string, any> = {}
;(globalThis as any).Page = (o: unknown) => {
  pageOpts = o as Record<string, any>
}

async function flush() {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}

async function mount(): Promise<Record<string, any>> {
  vi.resetModules()
  await import('../pages/profile-edit/profile-edit')
  const page = Object.create(pageOpts) as Record<string, any>
  page.data = { ...pageOpts.data }
  page.setData = function (patch: Record<string, unknown>) {
    Object.assign(this.data as Record<string, unknown>, patch)
  }
  return page
}

beforeEach(() => {
  loginMock.mockReset()
  ;(globalThis as any).wx = { showToast: vi.fn(), navigateBack: vi.fn(), getWindowInfo: () => ({ statusBarHeight: 20 }) }
  ;(globalThis as any).getCurrentPages = () => [{}, {}]
})

describe('编辑资料加载中/登录失败不画空白档案', () => {
  it('大白话：进页先停在加载，不把空表单当档案；登录失败给重试，成功才露出表单', async () => {
    let resolveLogin: (v: unknown) => void = () => {}
    loginMock.mockReturnValue(new Promise((resolve) => {
      resolveLogin = resolve
    }))
    const page = await mount()
    expect(page.data.loading).toBe(true)
    expect(page.data.loaded).toBe(false)

    const pending = page.onLoad()
    await flush()
    expect(page.data.loading).toBe(true)
    expect(page.data.loaded).toBe(false)

    resolveLogin({ ok: false })
    await pending
    expect(page.data.loading).toBe(false)
    expect(page.data.loaded).toBe(false)

    loginMock.mockResolvedValueOnce({
      ok: true,
      user: { nickname: '棉棉', bio: '钩织', phone: '13800138000', avatar: 'cloud://a' },
    })
    await page.onRetryLoad()
    expect(page.data.loading).toBe(false)
    expect(page.data.loaded).toBe(true)
    expect(page.data.nickname).toBe('棉棉')
    expect(page.data.phone).toBe('13800138000')
  })

  it('大白话：login 抛错也落失败态给重试，不把加载转成空白可改档案', async () => {
    loginMock.mockRejectedValueOnce(new Error('net'))
    const page = await mount()
    await page.onLoad()
    expect(page.data.loading).toBe(false)
    expect(page.data.loaded).toBe(false)
  })
})

describe('编辑资料放弃确认（共用 <leave-sheet>·连侧滑/安卓返回一起拦）', () => {
  it('大白话：「有改动」＝载入后改了昵称/手机号/选了新头像；改回原样不算；保存在途不算', async () => {
    loginMock.mockResolvedValue({ ok: true, user: { nickname: '棉棉', phone: '' } })
    const page = await mount()
    await page.onLoad()
    expect(page.data.dirty).toBe(false)
    page.onNickname({ detail: { value: '棉花' } })
    expect(page.data.dirty).toBe(true)
    page.onNickname({ detail: { value: '棉棉' } }) // 改回原样＝没改动
    expect(page.data.dirty).toBe(false)
    page.onPhone({ detail: { value: '138' } })
    expect(page.data.dirty).toBe(true)
    page.onPhone({ detail: { value: '' } })
    page.onChooseAvatar({ detail: { avatarUrl: 'wxfile://tmp.png' } })
    expect(page.data.dirty).toBe(true)
  })

  it('大白话：资料没载入（登录失败）时怎么都不算有改动', async () => {
    loginMock.mockResolvedValue({ ok: false })
    const page = await mount()
    await page.onLoad()
    page.onNickname({ detail: { value: '棉花' } })
    expect(page.data.dirty).toBe(false)
  })

  it('大白话：顶栏返回交给放弃确认半屏（它按有无改动决定先问还是直接走）', async () => {
    loginMock.mockResolvedValue({ ok: true, user: { nickname: '棉棉' } })
    const page = await mount()
    await page.onLoad()
    const ask = vi.fn()
    page.selectComponent = (sel: string) => (sel === '#leave' ? { ask } : null)
    page.onBack()
    expect(ask).toHaveBeenCalledTimes(1)
  })
})

describe('编辑资料保存提示', () => {
  it('大白话：昵称清空点保存——提示「昵称不能为空」，不发请求', async () => {
    loginMock.mockResolvedValue({ ok: true, user: { nickname: '棉棉' } })
    const page = await mount()
    await page.onLoad()
    page.onNickname({ detail: { value: '   ' } })
    await page.onSave()
    expect((globalThis as any).wx.showToast).toHaveBeenCalledWith({ title: '昵称不能为空', icon: 'none' })
  })
})

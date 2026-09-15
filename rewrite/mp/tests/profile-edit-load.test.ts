// 编辑资料页加载/失败分治（根因#14）：login 未返回或失败时不得画出空白可编辑档案。
// #272 只挡退页后迟到回包；本页加载中/失败仍会露出空表单+小鸭子，点保存才说没加载好。
// Page 桩同 me-cont-failed.test.ts；wxml 走 ?raw（E34·mp 测试不进 node:fs）。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import wxmlRaw from '../pages/profile-edit/profile-edit.wxml?raw'

const { loginMock } = vi.hoisted(() => ({ loginMock: vi.fn() }))
vi.mock('../api/user', () => ({ login: loginMock, updateProfile: vi.fn() }))
vi.mock('../lib/haptics', () => ({ tapHaptic: vi.fn() }))

let pageOpts: Record<string, any> = {}
;(globalThis as any).Page = (o: unknown) => {
  pageOpts = o as Record<string, any>
}

function stripWxml(src: string): string {
  return src.replace(/<!--[\s\S]*?-->/g, '')
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
  ;(globalThis as any).wx = { showToast: vi.fn() }
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

  it('大白话：加载块和失败重试挡住空表单——鸭子头像/输入/保存只在资料载入成功后出现', () => {
    const wxml = stripWxml(wxmlRaw)
    expect(wxml).toMatch(/wx:if="\{\{loading\}\}"/)
    expect(wxml).toMatch(/bind:tap="onRetryLoad"/)
    expect(wxml).toContain('重试')
    const loadChunk = wxml.split(/wx:if="\{\{loading\}\}"/)[1]?.split(/wx:(?:elif|else)/)[0] || ''
    expect(loadChunk).not.toMatch(/chooseAvatar|type="nickname"|onSave|>保存</)
    expect(wxml).toMatch(/wx:(?:else|elif|if)="\{\{loaded\}\}"[\s\S]*chooseAvatar|wx:else[\s\S]*chooseAvatar/)
  })
})

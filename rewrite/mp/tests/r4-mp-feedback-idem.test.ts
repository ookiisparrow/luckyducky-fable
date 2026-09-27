// 意见反馈超时重交防重复落库（小程序半边）：同一份内容的重交复用同一个幂等键，云端据此只留一条；
// 改了分类/内容/联系方式就是新的一次提交，换新键。只桩云调用（callApp），api 用真的。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { callAppMock } = vi.hoisted(() => ({ callAppMock: vi.fn() }))
vi.mock('../utils/cloud', () => ({ callApp: callAppMock }))
vi.mock('../lib/haptics', () => ({ tapHaptic: vi.fn() }))

let pageOpts: Record<string, any> = {}
;(globalThis as any).Page = (o: unknown) => {
  pageOpts = o as Record<string, any>
}

async function mount(): Promise<Record<string, any>> {
  vi.resetModules()
  await import('../pages/feedback/feedback')
  const page = Object.create(pageOpts) as Record<string, any>
  page.data = { ...pageOpts.data }
  page.setData = function (patch: Record<string, unknown>) {
    Object.assign(this.data as Record<string, unknown>, patch)
  }
  return page
}

const keys = () => callAppMock.mock.calls.map((c: any[]) => c[1].idempotencyKey)

beforeEach(() => {
  callAppMock.mockReset().mockResolvedValue({ ok: false, error: 'CALL_TIMEOUT' })
  ;(globalThis as any).wx = { showToast: vi.fn(), navigateBack: vi.fn() }
})

describe('意见反馈：幂等键', () => {
  it('大白话：超时没等到回包、原样再交——带同一个键（云端其实写过了，不会再落一条）', async () => {
    const page = await mount()
    page.onContent({ detail: { value: '按钮点不动' } })
    await page.onSubmit()
    await page.onSubmit()
    expect(keys()).toHaveLength(2)
    expect(keys()[0]).toMatch(/\S{8,}/)
    expect(keys()[1]).toBe(keys()[0])
  })

  it('大白话：超时后改了内容、分类或联系方式再交——算新的一次，换新键', async () => {
    const page = await mount()
    page.onContent({ detail: { value: '按钮点不动' } })
    await page.onSubmit()
    page.onContent({ detail: { value: '按钮还是点不动' } })
    await page.onSubmit()
    page.onCat({ currentTarget: { dataset: { key: 'idea' } } })
    await page.onSubmit()
    page.onContact({ detail: { value: 'wx1' } })
    await page.onSubmit()
    expect(new Set(keys()).size).toBe(4)
  })
})

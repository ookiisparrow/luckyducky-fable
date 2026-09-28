// 写评价提交失败：云端错误码逐个映射成用户语言提示，未知/空错误码走兜底，并解锁 busy 允许再提交。
// Page 桩同 me-cont-failed.test.ts。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { submitMock } = vi.hoisted(() => ({ submitMock: vi.fn() }))
vi.mock('../api/reviews', () => ({ submitReview: submitMock }))
vi.mock('../lib/haptics', () => ({ tapHaptic: vi.fn() }))

let pageOpts: Record<string, any> = {}
;(globalThis as any).Page = (o: unknown) => {
  pageOpts = o as Record<string, any>
}

async function mount(): Promise<Record<string, any>> {
  vi.resetModules()
  await import('../pages/review/review')
  const page = Object.create(pageOpts) as Record<string, any>
  page.data = { ...pageOpts.data, rating: 5 }
  page.setData = function (patch: Record<string, unknown>) {
    Object.assign(this.data as Record<string, unknown>, patch)
  }
  return page
}

let toast: ReturnType<typeof vi.fn>
beforeEach(() => {
  toast = vi.fn()
  ;(globalThis as any).wx = { showToast: toast, showLoading: vi.fn(), hideLoading: vi.fn(), navigateBack: vi.fn() }
  submitMock.mockReset()
})

describe('写评价提交失败提示', () => {
  const cases: [unknown, string][] = [
    ['NOT_DONE', '订单完成后才能评价'],
    ['IMG_RISKY', '图片没通过审核，换一张再试'],
    ['SEC_CHECK_FAIL', '内容没通过审核，改一改再试'], // 云端文字违规/图片校不了都回这个码，分不开，统一说内容
    ['NETWORK', '提交没成功，稍后再试'],
    ['constructor', '提交没成功，稍后再试'],
    [undefined, '提交没成功，稍后再试'],
  ]
  for (const [error, title] of cases) {
    it(`大白话：错误码 ${String(error)} → 「${title}」，busy 解锁`, async () => {
      submitMock.mockResolvedValue({ ok: false, error })
      const page = await mount()
      await page.onSubmit()
      expect(toast).toHaveBeenCalledTimes(1)
      expect(toast).toHaveBeenCalledWith({ title, icon: 'none' })
      expect(page.data.busy).toBe(false)
    })
  }

  it('大白话：云端说「已评过」——提示后撤掉放弃拦截（dirty 清掉），1 秒后自动返回，期间不能再点发布', async () => {
    vi.useFakeTimers()
    submitMock.mockResolvedValue({ ok: false, error: 'REVIEWED' })
    const page = await mount()
    page.data.dirty = true
    await page.onSubmit()
    expect(toast).toHaveBeenCalledWith({ title: '这条已经评过了', icon: 'none' })
    expect(page.data.dirty).toBe(false)
    expect(page.data.busy).toBe(true)
    const back = (globalThis as any).wx.navigateBack
    vi.advanceTimersByTime(999)
    expect(back).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(back).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
})

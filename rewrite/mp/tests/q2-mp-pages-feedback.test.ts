// 意见反馈页行为：空内容拦截、提交参数（去空白·分类·联系方式）、成功锁到延时返回、三类失败文案、
// 在途防重、在途退页与延时返回坞的收尾。只桩云调用（callApp），api 用真的。Page 桩同 p-mp-order-page.test.ts。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { callAppMock } = vi.hoisted(() => ({ callAppMock: vi.fn() }))
vi.mock('../utils/cloud', () => ({ callApp: callAppMock }))
vi.mock('../lib/haptics', () => ({ tapHaptic: vi.fn() }))

let pageOpts: Record<string, any> = {}
;(globalThis as any).Page = (o: unknown) => {
  pageOpts = o as Record<string, any>
}

let wxMock: Record<string, any>
const toastTitles = () => wxMock.showToast.mock.calls.map((c: any[]) => c[0].title)

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

const fill = (page: Record<string, any>, content: string, contact = '', cat = '') => {
  if (cat) page.onCat({ currentTarget: { dataset: { key: cat } } })
  page.onContent({ detail: { value: content } })
  page.onContact({ detail: { value: contact } })
}

beforeEach(() => {
  callAppMock.mockReset().mockResolvedValue({ ok: true })
  wxMock = { showToast: vi.fn(), navigateBack: vi.fn() }
  ;(globalThis as any).wx = wxMock
})
afterEach(() => {
  vi.useRealTimers()
})

describe('意见反馈：提交', () => {
  it('大白话：什么都没写或只打了空格——提示「说点什么吧」，不发请求', async () => {
    const page = await mount()
    await page.onSubmit()
    fill(page, '   ')
    await page.onSubmit()
    expect(toastTitles()).toEqual(['说点什么吧', '说点什么吧'])
    expect(callAppMock).not.toHaveBeenCalled()
  })

  it('大白话：默认分类「有问题」；选了「提建议」就按 idea 提交，正文和联系方式去掉首尾空格', async () => {
    const page = await mount()
    expect(page.data.cat).toBe('bug')
    fill(page, '  希望加夜间模式 ', ' wx123 ', 'idea')
    await page.onSubmit()
    expect(callAppMock).toHaveBeenCalledWith('submitFeedback', {
      content: '希望加夜间模式',
      category: 'idea',
      contact: 'wx123',
      page: 'feedback',
      version: 'rw-m2',
      platform: 'mp',
      idempotencyKey: expect.any(String),
    })
  })

  it('大白话：提交成功——提示「收到，谢谢你」并挡住点击，0.8 秒后退回；这期间再点提交不会重发', async () => {
    vi.useFakeTimers()
    const page = await mount()
    fill(page, '好用')
    await page.onSubmit()
    expect(wxMock.showToast).toHaveBeenCalledWith({ title: '收到，谢谢你', icon: 'success', mask: true })
    expect(page.data.busy).toBe(true)
    await page.onSubmit()
    expect(callAppMock).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(799)
    expect(wxMock.navigateBack).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(wxMock.navigateBack).toHaveBeenCalledTimes(1)
  })

  it('大白话：失败按原因给话——太频繁 / 没过审核 / 其他都说稍后再试；按钮恢复可再提交', async () => {
    const page = await mount()
    fill(page, '内容')
    for (const error of ['RATE_LIMITED', 'SEC_CHECK_FAIL', 'CALL_TIMEOUT']) {
      callAppMock.mockResolvedValueOnce({ ok: false, error })
      await page.onSubmit()
      expect(page.data.busy, error).toBe(false)
    }
    expect(toastTitles()).toEqual(['说得有点频繁啦，歇一会', '内容没通过审核，换个说法再试', '提交没成功，稍后再试'])
    expect(wxMock.navigateBack).not.toHaveBeenCalled()
  })

  it('大白话：提交还没回来就连点——只发一次', async () => {
    let release!: (v: unknown) => void
    callAppMock.mockImplementation(() => new Promise((r) => (release = r)))
    const page = await mount()
    fill(page, '内容')
    const first = page.onSubmit()
    await page.onSubmit()
    expect(callAppMock).toHaveBeenCalledTimes(1)
    release({ ok: false, error: 'X' })
    await first
  })
})

describe('意见反馈：退页收尾', () => {
  it('大白话：提交在途就退出了页面——回包迟到不再弹提示、也不替下一页做返回', async () => {
    vi.useFakeTimers()
    let release!: (v: unknown) => void
    callAppMock.mockImplementation(() => new Promise((r) => (release = r)))
    const page = await mount()
    fill(page, '内容')
    const pending = page.onSubmit()
    page.onUnload()
    release({ ok: true })
    await pending
    vi.advanceTimersByTime(2000)
    expect(wxMock.showToast).not.toHaveBeenCalled()
    expect(wxMock.navigateBack).not.toHaveBeenCalled()
  })

  it('大白话：成功后 0.8 秒内自己先点了返回——延时返回取消，不会多退一页', async () => {
    vi.useFakeTimers()
    const page = await mount()
    fill(page, '内容')
    await page.onSubmit()
    page.onUnload()
    vi.advanceTimersByTime(2000)
    expect(wxMock.navigateBack).not.toHaveBeenCalled()
  })
})

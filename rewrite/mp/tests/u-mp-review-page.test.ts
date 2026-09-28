// 写评价页（v5 B3）：商品行/问句、换星撒花、没打分发布提示 + 星排抖动、发布中 → 已发布 → 返回、放弃确认的 dirty 判定、晒图上限。
// Page 桩同 me-cont-failed.test.ts；撒花/提示层（lib/pxFx）桩掉只看调用参数。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { submitMock, partyMock, hintMock } = vi.hoisted(() => ({ submitMock: vi.fn(), partyMock: vi.fn(), hintMock: vi.fn() }))
vi.mock('../api/reviews', () => ({ submitReview: submitMock }))
vi.mock('../lib/haptics', () => ({ tapHaptic: vi.fn() }))
vi.mock('../lib/pxFx', () => ({ fxParty: partyMock, fxHint: hintMock }))

let pageOpts: Record<string, any> = {}
;(globalThis as any).Page = (o: unknown) => {
  pageOpts = o as Record<string, any>
}

const askMock = vi.fn()
async function mount(query: Record<string, string> = {}): Promise<Record<string, any>> {
  vi.resetModules()
  await import('../pages/review/review')
  const page = Object.create(pageOpts) as Record<string, any>
  page.data = { ...pageOpts.data, tags: pageOpts.data.tags.map((t: object) => ({ ...t })) }
  page.setData = function (patch: Record<string, unknown>) {
    Object.assign(this.data as Record<string, unknown>, patch)
  }
  page.selectComponent = (sel: string) => (sel === '#leave' ? { ask: askMock } : null)
  page.onLoad(query)
  return page
}

let wxMock: Record<string, any>
beforeEach(() => {
  vi.useFakeTimers()
  submitMock.mockReset()
  partyMock.mockReset()
  hintMock.mockReset()
  askMock.mockReset()
  wxMock = { showToast: vi.fn(), showLoading: vi.fn(), hideLoading: vi.fn(), navigateBack: vi.fn() }
  ;(globalThis as any).wx = wxMock
})
afterEach(() => vi.useRealTimers())

const star = (n: number) => ({ currentTarget: { dataset: { n } } })

describe('写评价页', () => {
  it('大白话：商品行「名称 · 规格」+ 缩略图；问句带商品名，缺名字时问「这只小鸭」；封面只认 https/cloud 地址', async () => {
    const page = await mount({ orderId: 'o1', lineId: encodeURIComponent('p&1'), name: encodeURIComponent('云朵挂件'), spec: encodeURIComponent('奶白'), cover: encodeURIComponent('cloud://env/a.jpg') })
    expect(page.data).toMatchObject({ item: '云朵挂件 · 奶白', q: '云朵挂件钩得开心吗？', cover: 'cloud://env/a.jpg' })
    expect(page.lineId).toBe('p&1')

    const p2 = await mount({ cover: encodeURIComponent('javascript:alert(1)') })
    expect(p2.data).toMatchObject({ item: '', q: '这只小鸭钩得开心吗？', cover: '' })
    const p3 = await mount({ name: encodeURIComponent('小熊') })
    expect(p3.data.item).toBe('小熊')
  })

  it('大白话：点亮 5 星大撒花 170 粒、4 星 56 粒；只要换了星级就撒，同一颗再点不撒，3 星以下不撒', async () => {
    const page = await mount()
    page.onStar(star(5))
    expect(partyMock).toHaveBeenLastCalledWith(page, '#rv-star-5', true, 170)
    page.onStar(star(4))
    expect(partyMock).toHaveBeenLastCalledWith(page, '#rv-star-4', false, 56)
    page.onStar(star(4))
    page.onStar(star(3))
    expect(partyMock).toHaveBeenCalledTimes(2)
    expect(page.data.ratingLabel).toBe('一般')
  })

  it('大白话：没打分就点发布——提示「先点亮星星打个分」、星排抖 360ms，不提交', async () => {
    const page = await mount()
    expect(page.data.ratingLabel).toBe('点亮星星打个分')
    await page.onSubmit()
    expect(hintMock).toHaveBeenCalledWith(page, '先点亮星星打个分')
    expect(page.data.shake).toBe(true)
    vi.advanceTimersByTime(360)
    expect(page.data.shake).toBe(false)
    expect(submitMock).not.toHaveBeenCalled()
  })

  it('大白话：发布——先转「发布中」，成功提示「已发布 ✓」（原生提示跨页不断）、撤掉放弃拦截，再返回上一页', async () => {
    submitMock.mockResolvedValue({ ok: true })
    const page = await mount({ orderId: 'o1', lineId: 'L1' })
    page.onStar(star(5))
    expect(page.data.dirty).toBe(true)
    await page.onSubmit()
    expect(wxMock.showLoading).toHaveBeenCalledWith({ title: '发布中', mask: true })
    expect(wxMock.hideLoading).toHaveBeenCalled()
    expect(wxMock.showToast).toHaveBeenCalledWith({ title: '已发布', icon: 'success', mask: true })
    expect(page.data.dirty).toBe(false)
    expect(wxMock.navigateBack).not.toHaveBeenCalled()
    vi.advanceTimersByTime(800)
    expect(wxMock.navigateBack).toHaveBeenCalledTimes(1)
  })

  it('大白话：放弃确认的「有改动」＝星级/标签/文字（去空格）/照片任一非空；自绘返回键交给放弃确认半屏', async () => {
    const page = await mount()
    expect(page.data.dirty).toBe(false)
    page.onText({ detail: { value: '   ' } })
    expect(page.data.dirty).toBe(false)
    page.onText({ detail: { value: ' 好 ' } })
    expect(page.data.dirty).toBe(true)
    page.onText({ detail: { value: '' } })
    page.onTag({ currentTarget: { dataset: { i: 0 } } })
    expect(page.data.dirty).toBe(true)
    page.onTag({ currentTarget: { dataset: { i: 0 } } })
    expect(page.data.dirty).toBe(false)
    page.setData({ photos: ['cloud://a'] })
    page.onDelPhoto({ currentTarget: { dataset: { i: 0 } } })
    expect(page.data.dirty).toBe(false)
    page.onBack()
    expect(askMock).toHaveBeenCalledTimes(1)
  })

  it('大白话：晒图最多 3 张', async () => {
    const page = await mount()
    expect(page.data.maxPhotos).toBe(3)
  })
})

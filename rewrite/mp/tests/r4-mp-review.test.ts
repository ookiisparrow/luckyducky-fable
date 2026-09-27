// 写评价页两处与云端对齐：文字没过审核按 TEXT_RISKY 提示改文字（不再说成「图片没检查成功」）；
// 晒图传到 reviews/<本单号>/ 下——云端只收这个目录里的文件，传错目录整条评价会被拒。
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
  page.onLoad({ orderId: '202609270001', lineId: 'p1__红', name: '小鸭' })
  return page
}

let wxMock: Record<string, any>
beforeEach(() => {
  submitMock.mockReset()
  wxMock = {
    showToast: vi.fn(),
    navigateBack: vi.fn(),
    chooseMedia: vi.fn(async () => ({ tempFiles: [{ tempFilePath: 'tmp/1.jpg' }, { tempFilePath: 'tmp/2.jpg' }] })),
    cloud: { uploadFile: vi.fn(async ({ cloudPath }: { cloudPath: string }) => ({ fileID: 'cloud://env.x/' + cloudPath })) },
  }
  ;(globalThis as any).wx = wxMock
})

describe('写评价：文字审核失败', () => {
  it('大白话：云端说文字不合适（TEXT_RISKY）——提示改文字，按钮解锁', async () => {
    submitMock.mockResolvedValue({ ok: false, error: 'TEXT_RISKY' })
    const page = await mount()
    await page.onSubmit()
    expect(wxMock.showToast).toHaveBeenCalledWith({ title: '文字里有不合适的内容，请修改', icon: 'none' })
    expect(page.data.busy).toBe(false)
  })
})

describe('写评价：晒图上传目录', () => {
  it('大白话：每张图都传到 reviews/<本单号>/ 下（一层文件名，不再套目录）', async () => {
    const page = await mount()
    await page.onAddPhotos()
    const paths = wxMock.cloud.uploadFile.mock.calls.map((c: any[]) => c[0].cloudPath)
    expect(paths).toHaveLength(2)
    for (const p of paths) expect(p).toMatch(/^reviews\/202609270001\/[^/]+\.jpg$/)
    expect(new Set(paths).size).toBe(2)
    expect(page.data.photos).toEqual(paths.map((p: string) => 'cloud://env.x/' + p))
  })
})

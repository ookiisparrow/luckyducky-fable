// 物流页壳（拍板 8）：小货车 + 公司名 + 大号运单号 + 复制；「查看物流详情」进快递100 插件，插件打不开复制运单号兜底。
// 不做假时间轴。只桩云调用（callApp），api/映射都用真的。Page 桩同 me-cont-failed.test.ts。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { callAppMock } = vi.hoisted(() => ({ callAppMock: vi.fn() }))
vi.mock('../utils/cloud', () => ({ callApp: callAppMock }))
vi.mock('../lib/haptics', () => ({ tapHaptic: vi.fn() }))

let pageOpts: Record<string, any> = {}
;(globalThis as any).Page = (o: unknown) => {
  pageOpts = o as Record<string, any>
}

async function mount(id = 'o1'): Promise<Record<string, any>> {
  vi.resetModules()
  await import('../pages/logistics/logistics')
  const page = Object.create(pageOpts) as Record<string, any>
  page.data = { ...pageOpts.data }
  page.setData = function (patch: Record<string, unknown>) {
    Object.assign(this.data as Record<string, unknown>, patch)
  }
  page.onLoad({ id })
  return page
}

const ORDER = (over: Record<string, unknown> = {}) => ({
  _id: 'o1',
  status: 'shipped',
  amount: 128,
  items: [{ lineId: 'L1', name: '小鸭', price: 128, qty: 1 }],
  shipping: { company: '顺丰速运', trackingNo: 'SF123' },
  ...over,
})

let wxMock: Record<string, any>
beforeEach(() => {
  callAppMock.mockReset().mockResolvedValue({ ok: true, order: ORDER() })
  wxMock = { showToast: vi.fn(), setClipboardData: vi.fn(), navigateTo: vi.fn() }
  ;(globalThis as any).wx = wxMock
})

describe('物流页壳', () => {
  it('大白话：进页按单号取订单——显示承运方和运单号，待收货小货车开着走、完成卸货', async () => {
    const page = await mount()
    await page.reload()
    expect(callAppMock).toHaveBeenCalledWith('getOrderById', { id: 'o1' })
    expect(page.data).toMatchObject({ loading: false, loadFailed: false, company: '顺丰速运', trackingNo: 'SF123', pose: 'drive', cargo: 1 })

    callAppMock.mockResolvedValue({ ok: true, order: ORDER({ status: 'done' }) })
    await page.reload()
    expect(page.data.pose).toBe('unload')
  })

  it('大白话：复制运单号有提示；「查看物流详情」打开快递100（带公司编码），插件打不开退回复制运单号', async () => {
    const page = await mount()
    await page.reload()
    page.onCopy()
    expect(wxMock.setClipboardData.mock.calls[0][0].data).toBe('SF123')
    wxMock.setClipboardData.mock.calls[0][0].success()
    expect(wxMock.showToast).toHaveBeenCalledWith({ title: '已复制运单号', icon: 'none' })

    page.onOpen()
    const opts = wxMock.navigateTo.mock.calls[0][0]
    expect(opts.url).toBe('plugin://kuaidi100/index?num=SF123&appName=' + encodeURIComponent('小棉鸭') + '&com=shunfeng')
    opts.fail()
    expect(wxMock.setClipboardData).toHaveBeenCalledTimes(2)

    page.data.company = '不认识的快递'
    page.onOpen()
    expect(wxMock.navigateTo.mock.calls[1][0].url).not.toContain('&com=')
  })

  it('大白话：还没有运单号——复制和查看都不动作', async () => {
    callAppMock.mockResolvedValue({ ok: true, order: ORDER({ shipping: undefined, status: 'paid' }) })
    const page = await mount()
    await page.reload()
    expect(page.data.trackingNo).toBe('')
    page.onCopy()
    page.onOpen()
    expect(wxMock.setClipboardData).not.toHaveBeenCalled()
    expect(wxMock.navigateTo).not.toHaveBeenCalled()
  })

  it('大白话：网络失败亮重试（不误报没有运单）；点重试重新拉取', async () => {
    callAppMock.mockResolvedValue({ ok: false, error: 'CALL_TIMEOUT' })
    const page = await mount()
    await page.reload()
    expect(page.data).toMatchObject({ loading: false, loadFailed: true })
    callAppMock.mockResolvedValue({ ok: true, order: ORDER() })
    await page.onRetryLoad()
    expect(page.data).toMatchObject({ loadFailed: false, trackingNo: 'SF123' })
  })
})

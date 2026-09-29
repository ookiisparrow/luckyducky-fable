// 我的售后 / 订单详情：顾客撤回申请中的售后（按住 700ms·同订单页按住取消手感）。
// 只桩云调用（callApp），api/映射/按住计时都用真的。Page 桩同 u-mp-order-as-overlay。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { callAppMock } = vi.hoisted(() => ({ callAppMock: vi.fn() }))
vi.mock('../utils/cloud', () => ({ callApp: callAppMock }))
vi.mock('../lib/haptics', () => ({ tapHaptic: vi.fn() }))
vi.mock('../utils/customerService', () => ({ openCustomerService: vi.fn() }))

let pageOpts: Record<string, any> = {}
;(globalThis as any).Page = (o: unknown) => {
  pageOpts = o as Record<string, any>
}

async function mount(path: string, query: Record<string, string> = {}): Promise<Record<string, any>> {
  vi.resetModules()
  await import(path)
  const page = Object.create(pageOpts) as Record<string, any>
  page.data = { ...pageOpts.data }
  page.setData = function (patch: Record<string, unknown>) {
    Object.assign(this.data as Record<string, unknown>, patch)
  }
  page.onLoad?.(query)
  return page
}

const AS = (lineId: string, status: string, over: Record<string, unknown> = {}) => ({ _id: 'o1__' + lineId, orderId: 'o1', lineId, name: '小鸭', status, appliedAt: 1, refundAmount: 64, ...over })
const ORDER = { _id: 'o1', status: 'paid', amount: 128, items: [{ lineId: 'L1', name: '小鸭', price: 64, qty: 1 }, { lineId: 'L2', name: '云朵鸭', price: 64, qty: 1 }] }
const touch = (x = 10, y = 10) => ({ touches: [{ clientX: x, clientY: y }] })

let handlers: Record<string, (data: Record<string, any>) => unknown>
let wxMock: Record<string, any>
const toasts = () => wxMock.showToast.mock.calls.map((c: any[]) => c[0])
const withdrawCalls = () => callAppMock.mock.calls.filter((c: unknown[]) => c[0] === 'withdrawRefund')

beforeEach(() => {
  vi.useFakeTimers()
  let status = 'applied'
  handlers = {
    getOrderById: () => ({ ok: true, order: ORDER }),
    getMyAfterSales: () => ({ ok: true, list: [AS('L1', status), AS('L2', 'approved')] }),
    withdrawRefund: (d) => {
      status = 'withdrawn'
      return { ok: true, afterSale: AS(d.lineId, 'withdrawn') }
    },
  }
  callAppMock.mockReset().mockImplementation(async (action: string, data: Record<string, any>) =>
    handlers[action] ? handlers[action](data) : { ok: false, error: 'UNEXPECTED' }
  )
  wxMock = { showToast: vi.fn(), showModal: vi.fn(), showLoading: vi.fn(), hideLoading: vi.fn(), navigateTo: vi.fn(), redirectTo: vi.fn() }
  ;(globalThis as any).wx = wxMock
  ;(globalThis as any).getCurrentPages = () => [{}]
})
afterEach(() => vi.useRealTimers())

describe('我的售后：撤回申请', () => {
  const page = async () => {
    const p = await mount('../pages/aftersales/aftersales')
    await p.reload()
    return p
  }

  it('大白话：只有申请中的记录能撤；轻点提示「按住撤回申请」不调接口；按满 700ms 才撤，成功后刷新成「已撤回」', async () => {
    const p = await page()
    expect(p.data.list.map((a: any) => a.canWithdraw)).toEqual([true, false])

    p.onWithdrawStart({ ...touch(), currentTarget: { dataset: { i: 1 } } }) // 已同意那条：不出键，按了也不撤
    await vi.advanceTimersByTimeAsync(700)
    expect(withdrawCalls()).toHaveLength(0)

    const ev = { ...touch(), currentTarget: { dataset: { i: 0 } } }
    p.onWithdrawStart(ev)
    expect(p.data.holdId).toBe('o1__L1')
    vi.advanceTimersByTime(200)
    p.onWithdrawEnd()
    expect(p.data.holdId).toBe('')
    expect(withdrawCalls()).toHaveLength(0)
    expect(toasts().at(-1)).toEqual({ title: '按住撤回申请', icon: 'none' })

    p.onWithdrawStart(ev)
    await vi.advanceTimersByTimeAsync(700)
    expect(withdrawCalls()).toEqual([['withdrawRefund', { orderId: 'o1', lineId: 'L1' }]])
    expect(wxMock.showLoading).toHaveBeenCalled()
    expect(p.data.list[0]).toMatchObject({ status: 'withdrawn', statusLabel: '已撤回', canWithdraw: false })
    expect(toasts().at(-1)).toEqual({ title: '已撤回', icon: 'success' })
  })

  it('大白话：按着手指挪开就作废，不撤', async () => {
    const p = await page()
    p.onWithdrawStart({ ...touch(10, 10), currentTarget: { dataset: { i: 0 } } })
    p.onWithdrawMove(touch(10, 40))
    await vi.advanceTimersByTimeAsync(700)
    expect(withdrawCalls()).toHaveLength(0)
  })

  it('大白话：商家刚同意了——提示「商家已同意退款，正在处理，不能撤回了」并刷新成最新状态', async () => {
    const p = await page()
    handlers.withdrawRefund = () => ({ ok: false, error: 'BAD_STATUS:approved' })
    handlers.getMyAfterSales = () => ({ ok: true, list: [AS('L1', 'approved')] })
    p.onWithdrawStart({ ...touch(), currentTarget: { dataset: { i: 0 } } })
    await vi.advanceTimersByTimeAsync(700)
    expect(toasts().at(-1)).toEqual({ title: '商家已同意退款，正在处理，不能撤回了', icon: 'none' })
    expect(p.data.list[0].status).toBe('approved')
  })

  it('大白话：撤回在途再按不会重复发', async () => {
    const p = await page()
    let release: (v: unknown) => void = () => {}
    handlers.withdrawRefund = () => new Promise((r) => (release = r))
    const a = p.withdrawNow(0)
    const b = p.withdrawNow(0)
    release({ ok: true, afterSale: AS('L1', 'withdrawn') })
    await Promise.all([a, b])
    expect(withdrawCalls()).toHaveLength(1)
  })
})

describe('订单详情：撤回申请（老板 2026-09-29：申请售后后，底部「撤回申请」代替「申请售后」）', () => {
  const page = async () => {
    const p = await mount('../pages/order/order', { id: 'o1' })
    await p.reload()
    return p
  }

  it('大白话：有申请中的售后——底部出撤回键代替申请售后；按满 700ms 撤回后订单叠加消失、底部变回申请售后，那一行又能申请退款', async () => {
    handlers.getMyAfterSales = () => ({ ok: true, list: [AS('L1', 'applied')] })
    const p = await page()
    expect(p.data.head).toBe('售后中')
    expect(p.data.wdLines).toEqual(['L1'])

    p.onWithdrawStart(touch())
    expect(p.data.wdHold).toBe(true)
    vi.advanceTimersByTime(100)
    p.onWithdrawEnd()
    expect(withdrawCalls()).toHaveLength(0)
    expect(toasts().at(-1)).toEqual({ title: '按住撤回申请', icon: 'none' })

    handlers.getMyAfterSales = () => ({ ok: false, error: 'NET' }) // 刷新售后没拉到：也要靠本地并入的结果去掉叠加
    p.onWithdrawStart(touch())
    await vi.advanceTimersByTimeAsync(700)
    expect(withdrawCalls()).toEqual([['withdrawRefund', { orderId: 'o1', lineId: 'L1' }]])
    expect(p.data.head).toBe('待发货')
    expect(p.data.asLed).toEqual({ tone: 'var(--v5-ink)', halo: '' })
    expect(p.data.lineTags).toEqual({})
    expect(p.data.wdLines).toEqual([])
    expect(p.data.asHas).toBe(true) // 仍有售后记录：「查看售后进度」照出
    expect(toasts().at(-1)).toEqual({ title: '已撤回', icon: 'success' })

    await p.onAfterSale()
    expect(p.data.asBlock).toBe('')
    expect(p.data.asLines.map((l: any) => l.lineId)).toEqual(['L1', 'L2'])
  })

  it('大白话：两件都在申请中——按住一次两件一起撤回', async () => {
    handlers.getMyAfterSales = () => ({ ok: true, list: [AS('L1', 'applied'), AS('L2', 'applied')] })
    const p = await page()
    expect(p.data.wdLines).toEqual(['L1', 'L2'])
    handlers.withdrawRefund = (d: any) => ({ ok: true, afterSale: AS(d.lineId, 'withdrawn') })
    handlers.getMyAfterSales = () => ({ ok: false, error: 'NET' }) // 刷新没拉到：靠本地并入的两条撤回结果
    p.onWithdrawStart(touch())
    await vi.advanceTimersByTimeAsync(700)
    expect(withdrawCalls().map((c: any) => c[1].lineId)).toEqual(['L1', 'L2'])
    expect(p.data.wdLines).toEqual([])
  })

  it('大白话：没抢过商家（已同意）——提示并刷新', async () => {
    handlers.getMyAfterSales = () => ({ ok: true, list: [AS('L1', 'applied')] })
    const p = await page()
    handlers.withdrawRefund = () => ({ ok: false, error: 'BAD_STATUS:approved' })
    handlers.getMyAfterSales = () => ({ ok: true, list: [AS('L1', 'approved')] })
    p.onWithdrawStart(touch())
    await vi.advanceTimersByTimeAsync(700)
    expect(toasts().at(-1)).toEqual({ title: '商家已同意退款，正在处理，不能撤回了', icon: 'none' })
    expect(p.data.sub.text).toBe('退款处理中，完成后原路退回')
    expect(p.data.wdLines).toEqual([])
  })
})

// 老板 2026-09-29 拍板 3/4/5/6 在订单页的落点：
// 3 售后原因「无理由」排第一并默认选中；4 退款提交前显示云端试算「预计退款 ¥X」；
// 5 被拒的行写「已被拒绝，有疑问联系客服」并给客服入口；6 已评价的行出灰底「已评价」、不再出「写评价」。
// 只桩云调用（callApp）与客服入口，映射/页面逻辑都用真的。Page 桩同 p-mp-order-page.test.ts。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mapOrder } from '../lib/mapOrders'

const { callAppMock } = vi.hoisted(() => ({ callAppMock: vi.fn() }))
vi.mock('../utils/cloud', () => ({ callApp: callAppMock }))
vi.mock('../lib/haptics', () => ({ tapHaptic: vi.fn() }))
const { kefuMock } = vi.hoisted(() => ({ kefuMock: vi.fn() }))
vi.mock('../utils/customerService', () => ({ openCustomerService: kefuMock }))

let pageOpts: Record<string, any> = {}
;(globalThis as any).Page = (o: unknown) => {
  pageOpts = o as Record<string, any>
}
async function mountPage(path: string, query: Record<string, string>): Promise<Record<string, any>> {
  vi.resetModules()
  await import(path)
  const page = Object.create(pageOpts) as Record<string, any>
  page.data = { ...pageOpts.data, shown: [] }
  page._all = []
  page.setData = function (patch: Record<string, unknown>) {
    Object.assign(this.data as Record<string, unknown>, patch)
  }
  page.onLoad(query)
  return page
}
const mountOrder = () => mountPage('../pages/order/order', { id: 'o1' })

let handlers: Record<string, (data: Record<string, any>) => unknown>
let wxMock: Record<string, any>
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}
const estCalls = () => callAppMock.mock.calls.filter((c: unknown[]) => c[0] === 'estimateRefund').map((c: unknown[]) => c[1])
const tapV = (v: string) => ({ currentTarget: { dataset: { v } } })
const line = (lineId: string, name: string, spec = '') => ({ lineId, name, spec, priceLabel: '', qty: 1, enteredQty: 0, refundable: true, cover: '', reviewed: false })
const doneVm = (n = 1) => ({ id: 'o1', status: 'done', items: n === 1 ? [line('L1', '小鸭', '黄')] : [line('L1', '小鸭', '黄'), line('L2', '云朵鸭')] })

beforeEach(() => {
  handlers = { getMyAfterSales: () => ({ ok: true, list: [] }) }
  kefuMock.mockReset()
  callAppMock.mockReset().mockImplementation(async (action: string, data: Record<string, any>) =>
    handlers[action] ? handlers[action](data) : { ok: false, error: 'UNEXPECTED' }
  )
  wxMock = { showToast: vi.fn(), showModal: vi.fn(), showLoading: vi.fn(), hideLoading: vi.fn(), setClipboardData: vi.fn(), navigateTo: vi.fn(), redirectTo: vi.fn() }
  ;(globalThis as any).wx = wxMock
  ;(globalThis as any).getCurrentPages = () => [{}]
})

describe('拍板 3：售后原因「无理由」', () => {
  it('大白话：原因标签第一个是「无理由」且默认选中；直接提交带的就是「无理由」；其余四个照旧可选', async () => {
    handlers.applyRefund = () => ({ ok: true })
    const page = await mountOrder()
    page.data.vm = doneVm()
    await page.onAfterSale()
    expect(page.data.asReasons).toEqual(['无理由', '线材缺色', '少件', '做工问题', '其他'])
    expect(page.data.asReason).toBe('无理由')
    await page.onAsSubmit()
    expect(callAppMock).toHaveBeenCalledWith('applyRefund', { orderId: 'o1', lineId: 'L1', reason: '无理由' })
  })
})

describe('拍板 4：预计退款（云端试算）', () => {
  it('大白话：开弹层（退款）就按所选商品试算——在途显示「计算中…」，回来显示「预计退款 ¥X.XX」（云端给分，两位小数）', async () => {
    let release!: (v: unknown) => void
    handlers.estimateRefund = () => new Promise((r) => (release = r))
    const page = await mountOrder()
    page.data.vm = doneVm()
    await page.onAfterSale()
    expect(estCalls()).toEqual([{ orderId: 'o1', lineId: 'L1' }])
    expect(page.data.asEst).toBe('计算中…')
    release({ ok: true, refundFen: 17800 })
    await flush()
    expect(page.data.asEst).toBe('预计退款 ¥178.00')
  })

  it('大白话：试算失败——写「预计金额以审核为准」，不挡提交', async () => {
    handlers.estimateRefund = () => ({ ok: false, error: 'INTERNAL' })
    handlers.applyRefund = () => ({ ok: true })
    const page = await mountOrder()
    page.data.vm = doneVm()
    await page.onAfterSale()
    await flush()
    expect(page.data.asEst).toBe('预计金额以审核为准')
    await page.onAsSubmit()
    expect(callAppMock).toHaveBeenCalledWith('applyRefund', { orderId: 'o1', lineId: 'L1', reason: '无理由' })
  })

  it('大白话：切换商品重算；先发的慢回包晚到也不会盖掉新商品的数', async () => {
    const pending: Array<(v: unknown) => void> = []
    handlers.estimateRefund = () => new Promise((r) => pending.push(r))
    const page = await mountOrder()
    page.data.vm = doneVm(2)
    await page.onAfterSale()
    page.onAsLine(tapV('L2'))
    expect(estCalls()).toEqual([{ orderId: 'o1', lineId: 'L1' }, { orderId: 'o1', lineId: 'L2' }])
    pending[1]({ ok: true, refundFen: 9900 })
    await flush()
    pending[0]({ ok: true, refundFen: 17800 }) // L1 的旧回包迟到
    await flush()
    expect(page.data.asEst).toBe('预计退款 ¥99.00')
  })

  it('大白话：切到换货/补发不显示预计退款也不试算；切回退款再算一次', async () => {
    handlers.estimateRefund = () => ({ ok: true, refundFen: 100 })
    const page = await mountOrder()
    page.data.vm = doneVm()
    await page.onAfterSale()
    await flush()
    page.onAsType(tapV('换货'))
    expect(page.data.asEst).toBe('')
    const pending: Array<(v: unknown) => void> = []
    handlers.estimateRefund = () => new Promise((r) => pending.push(r))
    page.onAsType(tapV('退款'))
    pending[0]({ ok: true, refundFen: 100 })
    await flush()
    expect(estCalls()).toHaveLength(2)
    expect(page.data.asEst).toBe('预计退款 ¥1.00')
  })

  it('大白话：已切到换货后旧的试算回包才到——不把预计退款写回来', async () => {
    const pending: Array<(v: unknown) => void> = []
    handlers.estimateRefund = () => new Promise((r) => pending.push(r))
    const page = await mountOrder()
    page.data.vm = doneVm()
    await page.onAfterSale()
    page.onAsType(tapV('补发'))
    pending[0]({ ok: true, refundFen: 100 })
    await flush()
    expect(page.data.asEst).toBe('')
  })
})

describe('拍板 5：被拒的行', () => {
  const rejected = (lineId: string) => ({ _id: 'o1__' + lineId, orderId: 'o1', lineId, status: 'rejected', appliedAt: 1 })

  it('大白话：唯一一件被拒——「退款」置灰写「已被拒绝，有疑问联系客服」，给「联系客服」键，点了带订单上下文去客服；不试算', async () => {
    handlers.getMyAfterSales = () => ({ ok: true, list: [rejected('L1')] })
    const page = await mountOrder()
    page.data.vm = doneVm()
    await page.onAfterSale()
    expect(page.data).toMatchObject({ asOpen: true, asBlock: '已被拒绝，有疑问联系客服', asRejKefu: true })
    expect(estCalls()).toHaveLength(0)
    page.onAsKefu()
    expect(kefuMock).toHaveBeenCalledTimes(1)
    expect(kefuMock.mock.calls[0][0]).toBe('订单号：o1\n商品：小鸭 · 黄\n售后：退款已被拒绝')
  })

  it('大白话：两件里一件被拒——还能退另一件；弹层里点名被拒的那件「已被拒绝，有疑问联系客服」并给客服入口', async () => {
    handlers.getMyAfterSales = () => ({ ok: true, list: [rejected('L1')] })
    const page = await mountOrder()
    page.data.vm = doneVm(2)
    await page.onAfterSale()
    expect(page.data.asBlock).toBe('')
    expect(page.data.asLines.map((l: { lineId: string }) => l.lineId)).toEqual(['L2'])
    expect(page.data.asRej).toBe('小鸭 · 黄')
    expect(page.data.asRejKefu).toBe(true)
  })

  it('大白话：没有被拒的——不出这行、不出客服键', async () => {
    const page = await mountOrder()
    page.data.vm = doneVm(2)
    await page.onAfterSale()
    expect(page.data).toMatchObject({ asRej: '', asRejKefu: false })
  })
})

describe('拍板 6：已评价', () => {
  const raw = (reviewedLineIds?: string[]) => ({
    _id: 'o1', status: 'done', amount: 1,
    items: [{ lineId: 'A', name: 'a', price: 1, qty: 1 }, { lineId: 'B', name: 'b', price: 1, qty: 1 }],
    ...(reviewedLineIds ? { reviewedLineIds } : {}),
  })

  it('大白话：映射——云端给的已评价行打上 reviewed；全评完才算整单已评价；云端没带（评价读失败）一律当没评过', () => {
    const part = mapOrder(raw(['A']))!
    expect(part.items.map((l) => l.reviewed)).toEqual([true, false])
    expect(part.reviewedAll).toBe(false)
    expect(mapOrder(raw(['A', 'B']))!.reviewedAll).toBe(true)
    const unknown = mapOrder(raw())!
    expect(unknown.items.every((l) => !l.reviewed)).toBe(true)
    expect(unknown.reviewedAll).toBe(false)
    expect(mapOrder({ ...raw(['A', 'B']), status: 'paid' })!.reviewedAll).toBe(false) // 未完成的单不算
  })

  it('大白话：详情里已评价的那件点了不跳评价页；没评的照常跳', async () => {
    handlers.getOrderById = () => ({ ok: true, order: raw(['A']) })
    const page = await mountOrder()
    await page.reload()
    page.onWriteReview({ currentTarget: { dataset: { i: 0 } } })
    expect(wxMock.navigateTo).not.toHaveBeenCalled()
    page.onWriteReview({ currentTarget: { dataset: { i: 1 } } })
    expect(wxMock.navigateTo.mock.calls[0][0].url).toContain('lineId=B')
  })

  it('大白话：列表里全评完的单——卡片标「已评价」，点了也不进评价', async () => {
    handlers.getMyOrders = () => ({ ok: true, list: [raw(['A', 'B']), { ...raw(['A']), _id: 'o2' }] })
    const page = await mountPage('../pages/order-list/order-list', {})
    await page.reload()
    expect(page.data.shown.map((o: { reviewedAll: boolean }) => o.reviewedAll)).toEqual([true, false])
    page.onReview({ currentTarget: { dataset: { id: 'o1' } } })
    expect(wxMock.navigateTo).not.toHaveBeenCalled()
    page.onReview({ currentTarget: { dataset: { id: 'o2' } } })
    expect(wxMock.navigateTo).toHaveBeenCalledWith({ url: '/pages/order/order?id=o2&pick=review' })
  })
})

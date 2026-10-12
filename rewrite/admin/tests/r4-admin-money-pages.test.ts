// @vitest-environment happy-dom
// 钱页（Refunds / Orders）写失败文案：超时这类「可能已经生效」的码不能再冠「X没成功：」——前后自相矛盾、诱人重复提交；
// 业务码照旧「X没成功：中文原因」。另：越规退款查单快速换单号连查，只让最后一次查的结果落地。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'

const api = vi.hoisted(() => ({
  listRefunds: vi.fn(),
  refundCounts: vi.fn(),
  approveRefund: vi.fn(),
  rejectRefund: vi.fn(),
  getRefundDetail: vi.fn(),
  listOrders: vi.fn(),
  overrideRefund: vi.fn(),
  orderCounts: vi.fn(),
  getOrderDetail: vi.fn(),
  shipOrder: vi.fn(),
  shipOrders: vi.fn(),
  clearFeeMismatch: vi.fn(),
  recordPaidFee: vi.fn(),
}))
vi.mock('../src/api/money', () => api)

import Refunds from '../src/pages/Refunds.vue'
import Orders from '../src/pages/Orders.vue'
import CONTRACT from '../../../tests/contracts/admin-money.json'

const sample = (name: string) => structuredClone((CONTRACT.cases as unknown as Record<string, { sample: any }>)[name].sample)
const TIMEOUT_TEXT = '服务器太久没回话。如果刚才是提交操作，可能已经生效——先刷新看看，再决定要不要重试。'
const TIMEOUT = { ok: false, status: 0, error: 'CALL_TIMEOUT' }

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset()
  api.listRefunds.mockResolvedValue(sample('listRefunds'))
  api.refundCounts.mockResolvedValue(sample('refundCounts'))
  api.getRefundDetail.mockResolvedValue(sample('getRefundDetail'))
  api.orderCounts.mockResolvedValue({ ok: true, counts: { all: 1 } })
  api.getOrderDetail.mockResolvedValue({ ok: true, activations: {} })
})
afterEach(() => {
  vi.unstubAllGlobals()
})

async function mountRefunds() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div/>' } }] })
  await router.push('/')
  await router.isReady()
  const w = mount(Refunds, { global: { plugins: [router] } })
  await flushPromises()
  return w
}
type W = Awaited<ReturnType<typeof mountRefunds>>
const btn = (w: W, text: string) => w.findAll('button').find((b) => b.text() === text)

async function openReview(w: W) {
  await btn(w, '审核')!.trigger('click')
  await flushPromises()
}

describe('Refunds.vue 写失败文案', () => {
  it('大白话：同意退款超时，只说「可能已经生效、先刷新看看」，不再冠「退款没成功」', async () => {
    api.approveRefund.mockResolvedValue(TIMEOUT)
    const w = await mountRefunds()
    await openReview(w)
    for (const c of w.findAll('.ck input[type=checkbox]')) await c.setValue(true)
    await w.findAll('button').find((b) => b.text().includes('同意退款'))!.trigger('click')
    await flushPromises()
    expect(w.find('.decide-err').text()).toBe(TIMEOUT_TEXT)
  })

  it('大白话：拒绝退款超时，同样不冠「拒绝没成功」', async () => {
    api.rejectRefund.mockResolvedValue(TIMEOUT)
    const w = await mountRefunds()
    await openReview(w)
    await btn(w, '拒绝退款（需填原因）')!.trigger('click')
    await w.find('aside textarea').setValue('激活卡已拆用')
    await btn(w, '确认拒绝')!.trigger('click')
    await flushPromises()
    expect(w.find('.decide-err').text()).toBe(TIMEOUT_TEXT)
  })

  it('大白话：业务码照旧「退款没成功：中文原因」', async () => {
    api.approveRefund.mockResolvedValue({ ok: false, status: 400, error: 'REFUND_TRIGGER_FAIL' })
    const w = await mountRefunds()
    await openReview(w)
    for (const c of w.findAll('.ck input[type=checkbox]')) await c.setValue(true)
    await w.findAll('button').find((b) => b.text().includes('同意退款'))!.trigger('click')
    await flushPromises()
    expect(w.find('.decide-err').text()).toBe('退款没成功：退款没发出去，请稍后重试')
  })

  // 退款前读售后单/支付配置失败也回 DOC_READ_FAIL：这时钱没动，要冠「退款没成功」，不能只说「读不出来」让人以为可能退了
  it('大白话：同意退款时读库失败（DOC_READ_FAIL），说「退款没成功：云端数据暂时读不出来」', async () => {
    api.approveRefund.mockResolvedValue({ ok: false, status: 200, error: 'DOC_READ_FAIL' })
    const w = await mountRefunds()
    await openReview(w)
    for (const c of w.findAll('.ck input[type=checkbox]')) await c.setValue(true)
    await w.findAll('button').find((b) => b.text().includes('同意退款'))!.trigger('click')
    await flushPromises()
    expect(w.find('.decide-err').text()).toBe('退款没成功：云端数据暂时读不出来。请稍后重试。')
  })

  it('大白话：越规退款提交超时，不冠「越规退款没成功」', async () => {
    api.listOrders.mockResolvedValue(sample('listOrders'))
    api.overrideRefund.mockResolvedValue(TIMEOUT)
    const ORDER = sample('listOrders').list[0]._id
    const w = await mountRefunds()
    await btn(w, '越规退款')!.trigger('click')
    await w.find('input[placeholder="输入订单号"]').setValue(ORDER)
    await btn(w, '查找')!.trigger('click')
    await flushPromises()
    await w.find('input[name="ov-line"]').setValue(true)
    await w.find('.ov-dialog textarea').setValue('客服特批')
    await w.find('.ov-dialog .ck input').setValue(true)
    await btn(w, '发起越规退款')!.trigger('click')
    await flushPromises()
    const msgs = w.findAll('.ov-msg')
    expect(msgs[msgs.length - 1].text()).toBe(TIMEOUT_TEXT)
  })
})

describe('Refunds.vue 越规退款查单乱序', () => {
  const order = (id: string) => ({ ok: true, list: [{ ...sample('listOrders').list[0], _id: id }] })

  it('大白话：先查 A 再查 B，A 的回包晚到，卡片仍是 B', async () => {
    let releaseA: (v: unknown) => void = () => {}
    let releaseB: (v: unknown) => void = () => {}
    api.listOrders.mockReturnValueOnce(new Promise((r) => (releaseA = r))).mockReturnValueOnce(new Promise((r) => (releaseB = r)))
    const w = await mountRefunds()
    await btn(w, '越规退款')!.trigger('click')
    const input = w.find('input[placeholder="输入订单号"]')
    await input.setValue('A')
    await btn(w, '查找')!.trigger('click')
    await input.setValue('B')
    await btn(w, '查找')!.trigger('click')
    releaseB(order('B'))
    await flushPromises()
    releaseA(order('A'))
    await flushPromises()
    expect(w.find('.ov-dialog .summary strong').text()).toBe('B')
  })

  it('大白话：先查 A 再清空重查，A 的失败回包晚到，不把「查找失败」盖到新提示上', async () => {
    let releaseA: (v: unknown) => void = () => {}
    api.listOrders.mockReturnValueOnce(new Promise((r) => (releaseA = r)))
    const w = await mountRefunds()
    await btn(w, '越规退款')!.trigger('click')
    const input = w.find('input[placeholder="输入订单号"]')
    await input.setValue('A')
    await btn(w, '查找')!.trigger('click')
    await input.setValue(' ')
    await input.trigger('keyup.enter')
    releaseA({ ok: false, status: 0, error: 'NETWORK:x' })
    await flushPromises()
    expect(w.find('.ov-msg').text()).toBe('先输入订单号')
  })
})

describe('Refunds.vue 越规退款提交在途', () => {
  const order = (id: string) => ({ ok: true, list: [{ ...sample('listOrders').list[0], _id: id }] })
  async function submitA() {
    let release: (v: unknown) => void = () => {}
    api.listOrders.mockResolvedValue(order('A'))
    api.overrideRefund.mockReturnValueOnce(new Promise((r) => (release = r)))
    const w = await mountRefunds()
    await btn(w, '越规退款')!.trigger('click')
    await w.find('input[placeholder="输入订单号"]').setValue('A')
    await btn(w, '查找')!.trigger('click')
    await flushPromises()
    await w.find('input[name="ov-line"]').setValue(true)
    await w.find('.ov-dialog textarea').setValue('客服特批')
    await w.find('.ov-dialog .ck input').setValue(true)
    await btn(w, '发起越规退款')!.trigger('click')
    return { w, release: (v: unknown) => release(v) }
  }
  const lastMsg = (w: W) => w.findAll('.ov-msg')[w.findAll('.ov-msg').length - 1].text()

  it('大白话：A 的越规退款在途时不能换查 B（按钮锁、回车也不发）；A 失败的话点名是 A', async () => {
    const { w, release } = await submitA()
    await w.find('input[placeholder="输入订单号"]').setValue('B')
    expect(btn(w, '查找')!.attributes('disabled')).toBeDefined()
    await w.find('input[placeholder="输入订单号"]').trigger('keyup.enter')
    expect(api.listOrders).toHaveBeenCalledTimes(1)
    release({ ok: false, status: 400, error: 'NOTHING_LEFT' })
    await flushPromises()
    expect(lastMsg(w)).toBe('订单 A 越规退款没成功：这件商品已经没有可退金额了')
  })

  it('大白话：A 在途时关掉重开弹层，A 成功回来——横幅点名 A，不让人以为退的是别的单', async () => {
    const { w, release } = await submitA()
    await w.find('.ov-dialog .drawer-close').trigger('click')
    await btn(w, '越规退款')!.trigger('click')
    release({ ok: true, id: 'af9' })
    await flushPromises()
    expect(lastMsg(w)).toBe('✓ 已对订单 A 发起越规退款（售后单 af9），等微信回调确认到账')
  })
})

const orderRow = (extra: Record<string, unknown>) => ({
  ok: true,
  list: [{ id: 'o1', status: 'paid', items: [{ productId: 'p1', name: '材料包', qty: 1 }], amount: 99, paidFee: 9900, createdAt: Date.now(), address: { name: '张三' }, ...extra }],
  nextCursor: null,
  hasMore: false,
})
async function mountOrders() {
  const w = mount(Orders)
  await flushPromises()
  return w
}
const rowBtn = (w: Awaited<ReturnType<typeof mountOrders>>, text: string) => w.findAll('.ld-tr button').find((b) => b.text() === text)!

describe('Orders.vue 写失败文案', () => {
  it('大白话：发货超时，抽屉里只说「可能已经生效、先刷新看看」，不冠「发货没成功」', async () => {
    api.listOrders.mockResolvedValue(orderRow({}))
    api.shipOrder.mockResolvedValue(TIMEOUT)
    const w = await mountOrders()
    await rowBtn(w, '发货').trigger('click')
    await flushPromises()
    await w.find('input[placeholder="扫描或输入运单号"]').setValue('SF123')
    await w.findAll('button').find((b) => b.text() === '确认发货')!.trigger('click')
    await flushPromises()
    expect(w.find('.drawer-error').text()).toBe(TIMEOUT_TEXT)
  })

  it('大白话：解除金额异常超时，不冠「解除失败」', async () => {
    api.listOrders.mockResolvedValue(orderRow({ feeMismatch: true }))
    api.clearFeeMismatch.mockResolvedValue(TIMEOUT)
    const w = await mountOrders()
    await rowBtn(w, '去核对').trigger('click')
    await rowBtn(w, '确认已核对流水？').trigger('click')
    await flushPromises()
    expect(w.find('.ld-status').text()).toBe(TIMEOUT_TEXT)
  })

  it('大白话：补录实付超时，不冠「补录失败」；业务码照旧冠「补录失败：」', async () => {
    api.listOrders.mockResolvedValue(orderRow({ status: 'payment_exception', paidFee: undefined }))
    vi.stubGlobal('prompt', () => '12.34')
    api.recordPaidFee.mockResolvedValueOnce(TIMEOUT).mockResolvedValueOnce({ ok: false, status: 400, error: 'REFUND_EXISTS' })
    const w = await mountOrders()
    await rowBtn(w, '补录实付').trigger('click')
    await flushPromises()
    expect(w.find('.ld-status').text()).toBe(TIMEOUT_TEXT)
    await rowBtn(w, '补录实付').trigger('click')
    await flushPromises()
    expect(w.find('.ld-status').text()).toBe('补录失败：已有退款记录，不能补录')
  })
})

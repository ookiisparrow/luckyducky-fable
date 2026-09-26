// @vitest-environment happy-dom
// Refunds.vue 双勾选闸渲染回归（B9·admin 首个挂载层测试）：canApprove = canDecide && checkPkg && checkCard
// && !busy——此前只有 mapMoney 纯函数单测/?raw 字符串断言覆盖，模板 :disabled 绑定与 @click 接线从未被真跑过。
// 回包用 tests/contracts/admin-money.json 的 sample（云端测试对着真 adminApi 锁住）：手写回包单位写错（元写成分）也照样绿。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'

const { listRefundsMock, refundCountsMock, approveRefundMock, rejectRefundMock, getRefundDetailMock, listOrdersMock, overrideRefundMock } = vi.hoisted(() => ({
  listRefundsMock: vi.fn(),
  refundCountsMock: vi.fn(),
  approveRefundMock: vi.fn(),
  rejectRefundMock: vi.fn(),
  getRefundDetailMock: vi.fn(),
  listOrdersMock: vi.fn(),
  overrideRefundMock: vi.fn(),
}))
vi.mock('../src/api/money', () => ({
  listRefunds: listRefundsMock,
  refundCounts: refundCountsMock,
  approveRefund: approveRefundMock,
  rejectRefund: rejectRefundMock,
  getRefundDetail: getRefundDetailMock,
  listOrders: listOrdersMock,
  overrideRefund: overrideRefundMock,
}))

import Refunds from '../src/pages/Refunds.vue'
import CONTRACT from '../../../tests/contracts/admin-money.json'

const sample = (name: string) => structuredClone((CONTRACT.cases as unknown as Record<string, { sample: any }>)[name].sample)
const REFUND_ID = sample('listRefunds').list[0]._id

beforeEach(() => {
  listRefundsMock.mockReset().mockResolvedValue(sample('listRefunds'))
  refundCountsMock.mockReset().mockResolvedValue(sample('refundCounts'))
  getRefundDetailMock.mockReset().mockResolvedValue(sample('getRefundDetail'))
  approveRefundMock.mockReset().mockResolvedValue({ ok: true })
  listOrdersMock.mockReset()
  overrideRefundMock.mockReset()
})

// 批E 给 Refunds.vue 加了 route.query.q 深链预填，挂载须带真实 router
async function mountAt(path = '/') {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div/>' } }] })
  await router.push(path)
  await router.isReady()
  const w = mount(Refunds, { global: { plugins: [router] } })
  await flushPromises()
  return w
}
type W = Awaited<ReturnType<typeof mountAt>>
const btn = (w: W, text: string) => w.findAll('button').find((b) => b.text() === text)
const openReview = async (w: W) => {
  await btn(w, '审核')!.trigger('click')
  await flushPromises()
}

describe('Refunds.vue 人工验收双勾选闸（canApprove）', () => {
  it('大白话：两项都未勾选禁用，勾齐才启用，点击恰好调用一次 approveRefund(id)；退款额按元显示', async () => {
    const wrapper = await mountAt()

    expect(wrapper.find('.ld-td.amount').text()).toBe('退 ¥198.00') // 云端 refundAmount 是元
    const reviewBtn = wrapper.findAll('button').find((b) => b.text() === '审核')
    expect(reviewBtn).toBeTruthy()
    await reviewBtn!.trigger('click')
    await flushPromises()

    const findApprove = () => wrapper.findAll('button').find((b) => b.text().includes('同意退款'))
    expect(findApprove()!.attributes('disabled')).toBeDefined()

    const checks = wrapper.findAll('.ck input[type=checkbox]')
    expect(checks.length).toBe(2)
    await checks[0].setValue(true)
    expect(findApprove()!.attributes('disabled')).toBeDefined()

    await checks[1].setValue(true)
    expect(findApprove()!.attributes('disabled')).toBeUndefined()

    await findApprove()!.trigger('click')
    await flushPromises()
    expect(approveRefundMock).toHaveBeenCalledTimes(1)
    expect(approveRefundMock).toHaveBeenCalledWith(REFUND_ID)
  })
})

describe('Refunds.vue 退货权判据加载', () => {
  it('大白话：判据没回来前只显「判据加载中…」，不先画判据卡、不出重试入口', async () => {
    getRefundDetailMock.mockReturnValue(new Promise(() => {}))
    const w = await mountAt()
    await openReview(w)
    expect(w.find('.verdict-loading').exists()).toBe(true)
    expect(w.find('.crits').exists()).toBe(false)
    expect(btn(w, '重新加载判据')).toBeUndefined()
  })

  it('大白话：判据读失败——不画绿色「可退」，红条说原因；点「重新加载判据」再取一次，成功后判据出来、红条消失', async () => {
    getRefundDetailMock.mockResolvedValueOnce({ ok: false, status: 500, error: 'X1' })
    const w = await mountAt()
    await openReview(w)
    expect(w.find('.verdict').exists()).toBe(false)
    expect(w.find('.crits').exists()).toBe(false)
    expect(w.find('.decide-err').text()).toBe('判据加载失败：操作失败（X1）')

    await btn(w, '重新加载判据')!.trigger('click')
    await flushPromises()
    expect(getRefundDetailMock).toHaveBeenCalledTimes(2)
    expect(w.find('.verdict.ok').text()).toContain('可退')
    expect(w.find('.decide-err').exists()).toBe(false)
  })
})

describe('Refunds.vue 深链与搜索态', () => {
  const ORDER = sample('listRefunds').list[0].orderId

  it('大白话：带 ?q=单号 进来——搜索框预填、按单号跨状态检索一次，任何状态标签都不点亮', async () => {
    const w = await mountAt('/?q=' + ORDER)
    expect((w.find('input[placeholder^="搜索订单号"]').element as HTMLInputElement).value).toBe(ORDER)
    expect(listRefundsMock).toHaveBeenCalledTimes(1)
    expect(listRefundsMock).toHaveBeenCalledWith('applied', undefined, 20, ORDER)
    expect(w.find('.searching').text()).toContain(ORDER)
    expect(w.findAll('.ld-chip.on')).toHaveLength(0)
  })

  it('大白话：不带 q 进来——按「待审核」普通加载，「待审核」点亮', async () => {
    const w = await mountAt()
    expect(listRefundsMock).toHaveBeenCalledWith('applied', undefined, 20, '')
    expect(w.findAll('.ld-chip.on').map((c) => c.text())).toEqual(['待审核1'])
  })
})

describe('Refunds.vue 空栏提示与报错', () => {
  const EMPTY = { ok: true, list: [], nextCursor: null, hasMore: false }

  it('大白话：本栏空、别的栏有货——空态明说「已退款」有几单', async () => {
    listRefundsMock.mockResolvedValue(EMPTY)
    refundCountsMock.mockResolvedValue({ ok: true, counts: { all: 4, applied: 0, approved: 0, refunded: 4, rejected: 0 }, partial: false })
    const w = await mountAt()
    expect(w.find('.empty-text').text()).toBe('这一栏没有售后单——「已退款」有 4 单')
  })

  it('大白话：计数没读全——空态不引用数字，标签角标显「?」', async () => {
    listRefundsMock.mockResolvedValue(EMPTY)
    refundCountsMock.mockResolvedValue({ ok: true, counts: { all: 4, refunded: 4 }, partial: true })
    const w = await mountAt()
    expect(w.find('.empty-text').text()).toBe('这一栏没有售后单（其他栏计数暂不可用，刷新后再看）')
    expect(w.findAll('.chip-n.warn').length).toBeGreaterThan(0)
  })

  it('大白话：列表读失败说人话、不显空态；刷新在途时「刷新」按钮锁住，回来才解锁', async () => {
    listRefundsMock.mockResolvedValue({ ok: false, status: 0, error: 'NETWORK:fetch failed' })
    const w = await mountAt()
    expect(w.find('.ld-status').text()).toBe('加载失败：网络不通，请检查网络后重试。')
    expect(w.find('.empty-text').exists()).toBe(false)

    let release: (v: unknown) => void = () => {}
    listRefundsMock.mockReturnValueOnce(new Promise((r) => (release = r)))
    await btn(w, '刷新')!.trigger('click')
    expect(btn(w, '刷新')!.attributes('disabled')).toBeDefined()
    release(sample('listRefunds'))
    await flushPromises()
    expect(btn(w, '刷新')!.attributes('disabled')).toBeUndefined()
  })
})

describe('Refunds.vue 越规退款弹层', () => {
  const openOverride = async (w: W) => {
    await btn(w, '越规退款')!.trigger('click')
  }

  it('大白话：没填单号「查找」灰着；直接回车提示先输入订单号、不发请求', async () => {
    const w = await mountAt()
    await openOverride(w)
    expect(btn(w, '查找')!.attributes('disabled')).toBeDefined()
    await w.find('input[placeholder="输入订单号"]').trigger('keyup.enter')
    expect(listOrdersMock).not.toHaveBeenCalled()
    expect(w.find('.ov-msg').text()).toBe('先输入订单号')
  })

  it('大白话：提交失败标红说原因；提交成功标绿', async () => {
    listOrdersMock.mockResolvedValue(sample('listOrders'))
    const ORDER = sample('listOrders').list[0]._id
    const w = await mountAt()
    await openOverride(w)
    const submit = async () => {
      await w.find('input[placeholder="输入订单号"]').setValue(ORDER)
      await btn(w, '查找')!.trigger('click')
      await flushPromises()
      await w.find('input[name="ov-line"]').setValue(true)
      await w.find('.ov-dialog textarea').setValue('客服特批')
      await w.find('.ov-dialog .ck input').setValue(true)
      await btn(w, '发起越规退款')!.trigger('click')
      await flushPromises()
    }
    overrideRefundMock.mockResolvedValueOnce({ ok: false, status: 500, error: 'NOTHING_LEFT' })
    await submit()
    const lastMsg = () => w.findAll('.ov-msg')[w.findAll('.ov-msg').length - 1]
    const fail = lastMsg()
    expect(fail.text()).toBe('越规退款没成功：这件商品已经没有可退金额了')
    expect(fail.classes()).toContain('err')

    overrideRefundMock.mockResolvedValueOnce({ ok: true, id: 'af1' })
    await submit()
    const ok = lastMsg()
    expect(ok.text()).toContain('✓ 已发起越规退款（售后单 af1）')
    expect(ok.classes()).toContain('ok')
    expect(ok.classes()).not.toContain('err')
  })
})

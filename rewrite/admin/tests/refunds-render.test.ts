// @vitest-environment happy-dom
// Refunds.vue 双勾选闸渲染回归（B9·admin 首个挂载层测试）：canApprove = canDecide && checkPkg && checkCard
// && !busy——此前只有 mapMoney 纯函数单测/?raw 字符串断言覆盖，模板 :disabled 绑定与 @click 接线从未被真跑过。
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

beforeEach(() => {
  listRefundsMock.mockReset().mockResolvedValue({
    ok: true,
    list: [{ _id: 'r1', orderId: 'o1', status: 'applied', name: '钩织材料包', qty: 1, refundAmount: 9900, reason: '不想要了', appliedAt: Date.now(), buyerPhone: '13800001111' }],
    nextCursor: null,
    hasMore: false,
  })
  refundCountsMock.mockReset().mockResolvedValue({ ok: true, counts: { applied: 1, all: 1 } })
  getRefundDetailMock.mockReset().mockResolvedValue({
    ok: true,
    activation: { activated: false, entered: false, code: '', courseId: '' },
    lineRefundable: true,
    refundableQty: 1,
    lineFound: true,
  })
  approveRefundMock.mockReset().mockResolvedValue({ ok: true })
  rejectRefundMock.mockReset().mockResolvedValue({ ok: true })
  listOrdersMock.mockReset().mockResolvedValue({ ok: true, list: [] })
  overrideRefundMock.mockReset().mockResolvedValue({ ok: true, id: 'as-override-1' })
})

describe('Refunds.vue 人工验收双勾选闸（canApprove）', () => {
  it('大白话：两项都未勾选禁用，勾齐才启用，点击恰好调用一次 approveRefund(id)', async () => {
    // 批E（Phase3·main 并入）给 Refunds.vue 加了 route.query.q 深链预填，挂载须带真实 router
    //（同 products-render.test.ts 手法）；空 query → 深链分支不触发、走普通 reload，本测试行为不变。
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div/>' } }] })
    await router.push('/')
    await router.isReady()
    const wrapper = mount(Refunds, { global: { plugins: [router] } })
    await flushPromises()

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
    expect(approveRefundMock).toHaveBeenCalledWith('r1')
  })

  it('大白话：退款失败说人话，不裸甩英文码', async () => {
    approveRefundMock.mockResolvedValueOnce({ ok: false, error: 'ENTERED_NOT_REFUNDABLE' })
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div/>' } }] })
    await router.push('/')
    await router.isReady()
    const wrapper = mount(Refunds, { global: { plugins: [router] } })
    await flushPromises()

    const reviewBtn = wrapper.findAll('button').find((b) => b.text() === '审核')
    await reviewBtn!.trigger('click')
    await flushPromises()

    const checks = wrapper.findAll('.ck input[type=checkbox]')
    await checks[0].setValue(true)
    await checks[1].setValue(true)
    const approveBtn = wrapper.findAll('button').find((b) => b.text().includes('同意退款'))
    await approveBtn!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('退款没成功：这件商品已进课，不符合退款规则')
    expect(wrapper.text()).not.toContain('ENTERED_NOT_REFUNDABLE')
  })

  it('大白话：越规退款没填单号前按钮禁用，点回车会提示先输入订单号', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div/>' } }] })
    await router.push('/')
    await router.isReady()
    const wrapper = mount(Refunds, { global: { plugins: [router] } })
    await flushPromises()

    const overrideOpen = wrapper.findAll('button').find((b) => b.text().includes('越规退款'))
    await overrideOpen!.trigger('click')
    await flushPromises()

    const findBtn = wrapper.findAll('button').find((b) => b.text() === '查找')
    expect(findBtn!.attributes('disabled')).toBeDefined()

    const input = wrapper.find('.ov-find input')
    await input.trigger('keyup.enter')
    await flushPromises()

    const msg = wrapper.find('.ov-msg.err')
    expect(msg.exists()).toBe(true)
    expect(msg.text()).toBe('先输入订单号')
  })

  it('大白话：越规退款成功后结果提示走绿色高亮，不是灰说明字', async () => {
    listOrdersMock.mockResolvedValueOnce({
      ok: true,
      list: [
        {
          _id: 'OV-1',
          status: 'refund_required',
          amount: 199,
          goods: 199,
          address: { name: '特批买家', phone: '13500005555' },
          items: [{ lineId: 'p1__奶黄', productId: 'p1', name: '小棉鸭材料包', spec: '奶黄', qty: 1, price: 199 }],
        },
      ],
    })
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div/>' } }] })
    await router.push('/')
    await router.isReady()
    const wrapper = mount(Refunds, { global: { plugins: [router] } })
    await flushPromises()

    const overrideOpen = wrapper.findAll('button').find((b) => b.text().includes('越规退款'))
    await overrideOpen!.trigger('click')
    await flushPromises()

    const input = wrapper.find('.ov-find input')
    await input.setValue('OV-1')
    const findBtn = wrapper.findAll('button').find((b) => b.text() === '查找')
    await findBtn!.trigger('click')
    await flushPromises()

    const radio = wrapper.find('input[type=radio]')
    expect(radio.exists()).toBe(true)
    await radio.setValue(true)
    await wrapper.find('textarea').setValue('客服特批')
    await wrapper.find('.ck input[type=checkbox]').setValue(true)

    const submitBtn = wrapper.findAll('button').find((b) => b.text().includes('发起越规退款'))
    await submitBtn!.trigger('click')
    await flushPromises()

    const msg = wrapper.find('.ov-msg.ok')
    expect(msg.exists()).toBe(true)
    expect(msg.text()).toContain('已发起越规退款')
  })
})

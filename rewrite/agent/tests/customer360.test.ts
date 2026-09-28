// @vitest-environment happy-dom
// 坐席台右侧顾客 360：云端订单等面板是 { count, orders: [...] }，不能再被模板打成 [object Object]。
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'

const { postMock } = vi.hoisted(() => ({ postMock: vi.fn() }))
vi.mock('../src/api/client', () => ({
  post: postMock,
  logout: vi.fn(),
  listKb: vi.fn().mockResolvedValue({ ok: true, list: [] }),
}))
import Desk from '../src/Desk.vue'

const mounted: VueWrapper[] = []
afterEach(() => {
  mounted.splice(0).forEach((w) => w.unmount())
})

function serve360() {
  postMock.mockReset().mockImplementation(async (action: string) => {
    if (action === 'listMyActive') return { ok: true, sessions: [{ sessionId: 's1', externalUserId: 'wm-000001' }] }
    if (action === 'listQueue') return { ok: true, items: [] }
    if (action === 'getThread') return { ok: true, messages: [], nextCursor: 0 }
    if (action === 'getSessionCustomer360') {
      return {
        ok: true,
        panels: [
          {
            key: 'profile',
            label: '画像',
            data: { orderCount: 1, paidCount: 1, totalSpent: 12.5, ordersCapped: false },
          },
          {
            key: 'orders',
            label: '订单',
            data: {
              count: 1,
              capped: false,
              orders: [
                { id: 'o-1001', status: 'paid', amount: 12.5, createdAt: 1783046400000, itemCount: 2, trackingNo: 'SF1' },
              ],
            },
          },
        ],
      }
    }
    return { ok: true }
  })
}

describe('坐席台顾客 360 明细', () => {
  it('大白话：嵌套订单能看清单号和金额，不再打成 [object Object]；画像总消费按元原样显示', async () => {
    serve360()
    const w = mount(Desk)
    mounted.push(w)
    await flushPromises()
    const mine = w.findAll('aside .qitem').filter((q) => !q.find('.qinfo').exists())
    await mine[0].trigger('click')
    await flushPromises()

    const text = w.find('aside.right').text()
    // 直接插对象时，Vue 打出 JSON，普通拼接打出 [object Object]。两种都不许留下。
    expect(text).not.toContain('[object Object]')
    expect(text).not.toContain('"id"')
    expect(text).toContain('单号：o-1001')
    expect(text).toContain('金额（元）：12.5')
    expect(text).not.toContain('1250')
    expect(text).toContain('总消费（元）：12.5')
    expect(text).toContain('订单数：1')
    expect(text).toContain('件数：2')
    expect(text).not.toContain('orderCount')
    expect(text).not.toContain('totalSpent')
    expect(text).not.toContain('1783046400000')
    expect(text).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/)
  })
})

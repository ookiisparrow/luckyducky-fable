import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// 只测 store.pay 的状态同步逻辑，api 层 mock（payOrder 真实链路依赖微信收银台，云函数侧已有 pay.test.js）
vi.mock('@/api/order.js', () => ({
  createOrder: vi.fn(),
  getMyOrders: vi.fn(async () => []),
  confirmReceive: vi.fn(),
  payOrder: vi.fn(),
}))

import { payOrder } from '@/api/order.js'
import { useOrdersStore } from '@/store/orders.js'

beforeEach(() => {
  setActivePinia(createPinia())
  vi.mocked(payOrder).mockReset()
})

function seedPending(store) {
  store.list = [{ id: 'o1', status: 'pending', amount: 178, createdAt: Date.now() }]
}

describe('orders store · pay', () => {
  it('支付成功：本笔置 paid + paidAt（横幅/列表响应式切换）', async () => {
    const store = useOrdersStore()
    seedPending(store)
    vi.mocked(payOrder).mockResolvedValue({ paid: true })
    await store.pay('o1')
    expect(store.getById('o1').status).toBe('paid')
    expect(store.getById('o1').paidAt).toBeGreaterThan(0)
  })

  it('ORDER_CLOSED：本地同步 closed，错误继续向上抛（页面提示用）', async () => {
    const store = useOrdersStore()
    seedPending(store)
    vi.mocked(payOrder).mockRejectedValue(new Error('ORDER_CLOSED'))
    await expect(store.pay('o1')).rejects.toThrow('ORDER_CLOSED')
    expect(store.getById('o1').status).toBe('closed')
    expect(store.getById('o1').closedAt).toBeGreaterThan(0)
  })

  it('PAY_CANCELLED：状态不动（订单保留可继续支付），错误向上抛', async () => {
    const store = useOrdersStore()
    seedPending(store)
    vi.mocked(payOrder).mockRejectedValue(new Error('PAY_CANCELLED'))
    await expect(store.pay('o1')).rejects.toThrow('PAY_CANCELLED')
    expect(store.getById('o1').status).toBe('pending')
  })
})

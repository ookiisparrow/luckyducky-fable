import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// 只测 store 收口逻辑，api 层 mock（云函数闸门已有 applyRefund.test.js 覆盖）
vi.mock('@/api/aftersales.js', () => ({
  getMyAfterSales: vi.fn(),
  applyRefund: vi.fn(),
}))

import { getMyAfterSales, applyRefund } from '@/api/aftersales.js'
import { useAfterSalesStore } from '@/store/aftersales.js'

beforeEach(() => {
  setActivePinia(createPinia())
  vi.mocked(getMyAfterSales).mockReset()
  vi.mocked(applyRefund).mockReset()
})

describe('aftersales store', () => {
  it('load：拉取列表；无云（null）不覆盖已有数据', async () => {
    const store = useAfterSalesStore()
    vi.mocked(getMyAfterSales).mockResolvedValue([{ _id: 'o1__p1', orderId: 'o1', productId: 'p1', status: 'applied' }])
    await store.load()
    expect(store.list).toHaveLength(1)
    expect(store.has('o1', 'p1')).toBe(true)
    expect(store.has('o1', 'p2')).toBe(false)

    vi.mocked(getMyAfterSales).mockResolvedValue(null) // 云端失败/无云
    await store.load(true)
    expect(store.list).toHaveLength(1) // 不被清空
  })

  it('apply 成功：插入列表头部（可申请列表即时消失该条目）', async () => {
    const store = useAfterSalesStore()
    vi.mocked(applyRefund).mockResolvedValue({ _id: 'o1__p1', orderId: 'o1', productId: 'p1', status: 'applied' })
    const rec = await store.apply({ orderId: 'o1', productId: 'p1', reason: '' })
    expect(rec._id).toBe('o1__p1')
    expect(store.has('o1', 'p1')).toBe(true)
  })

  it('apply 云端拒绝：错误向上抛、列表不变；无云返回 null（演示路径）', async () => {
    const store = useAfterSalesStore()
    vi.mocked(applyRefund).mockRejectedValue(new Error('ALREADY_APPLIED'))
    await expect(store.apply({ orderId: 'o1', productId: 'p1' })).rejects.toThrow('ALREADY_APPLIED')
    expect(store.list).toHaveLength(0)

    vi.mocked(applyRefund).mockResolvedValue(null)
    expect(await store.apply({ orderId: 'o1', productId: 'p1' })).toBeNull()
  })
})

// 列表新鲜度单源（utils/fresh）：页面 onShow 拿它判断能不能跳过重拉；写类 api 完成时标脏——
// 做过改状态的事（下单/支付/取消/收货/售后·激活/进课/看视频写进度）回来必重拉，没做过就不闪 loading。
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../utils/cloud', () => ({ callApp: vi.fn(async () => ({ ok: true })) }))

import { FRESH_MS, isFresh, markStale, __resetForTest } from '../utils/fresh'
import { applyRefund, cancelOrder, confirmReceive, createOrder, getMyOrders, pay, withdrawRefund } from '../api/orders'
import { activateCourse, confirmEnter, getMyCourses, trackEvent } from '../api/learning'

const ADDR = { name: 'n', phone: '13800000000', region: 'r', detail: 'd' }

describe('isFresh', () => {
  beforeEach(() => __resetForTest())

  it('大白话：窗内且拉完之后没人写过 → 新鲜；从没拉过 / 过了窗 / 拉完之后有写 → 不新鲜', () => {
    const t = 1_000_000
    expect(isFresh('orders', 0, FRESH_MS, t)).toBe(false)
    expect(isFresh('orders', t - 1000, FRESH_MS, t)).toBe(true)
    expect(isFresh('orders', t - FRESH_MS, FRESH_MS, t)).toBe(false)
    vi.spyOn(Date, 'now').mockReturnValue(t - 500)
    markStale('orders')
    vi.restoreAllMocks()
    expect(isFresh('orders', t - 1000, FRESH_MS, t)).toBe(false) // 拉完（t-1000）之后（t-500）有写
    expect(isFresh('orders', t - 100, FRESH_MS, t)).toBe(true) // 写之后又拉过：新鲜
    expect(isFresh('learning', t - 1000, FRESH_MS, t)).toBe(true) // 别的 key 不受影响
  })
})

describe('写类 api 完成即标脏（读类不标）', () => {
  beforeEach(() => __resetForTest())

  it('大白话：订单的写（下单/支付/取消/收货/申请售后/撤回售后）任一件做完，orders 就不新鲜；只读 getMyOrders 不影响', async () => {
    const writes = [
      () => createOrder([{ id: 'p', qty: 1 }], ADDR),
      () => pay('o1'),
      () => cancelOrder('o1'),
      () => confirmReceive('o1'),
      () => applyRefund('o1', 'l1', '尺寸不合适'),
      () => withdrawRefund('o1', 'l1'),
    ]
    for (const w of writes) {
      __resetForTest()
      const fetchedAt = Date.now()
      expect(isFresh('orders', fetchedAt, FRESH_MS)).toBe(true)
      await w()
      expect(isFresh('orders', fetchedAt, FRESH_MS)).toBe(false)
    }
    __resetForTest()
    const fetchedAt = Date.now()
    await getMyOrders()
    expect(isFresh('orders', fetchedAt, FRESH_MS)).toBe(true)
  })

  it('大白话：激活课 / 进课 / 带课程的进度埋点做完，learning 就不新鲜；纯统计埋点与只读 getMyCourses 不影响', async () => {
    const writes = [() => activateCourse('CODE'), () => confirmEnter('CODE'), () => trackEvent('segment_done', 'player', 's1', { courseId: 'c1' }), () => trackEvent('watch_at', 'player', 's1', { courseId: 'c1', at: 3 })]
    for (const w of writes) {
      __resetForTest()
      const fetchedAt = Date.now()
      expect(isFresh('learning', fetchedAt, FRESH_MS)).toBe(true)
      await w()
      expect(isFresh('learning', fetchedAt, FRESH_MS)).toBe(false)
    }
    __resetForTest()
    const fetchedAt = Date.now()
    trackEvent('view_product', 'detail', 'p1')
    await getMyCourses()
    expect(isFresh('learning', fetchedAt, FRESH_MS)).toBe(true)
  })
})

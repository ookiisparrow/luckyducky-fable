// 左上返回键卡顿（老板 2026-10-01「重点排查左上方的返回键」）：返回键本身只 navigateBack；卡的是退回到的上一页
// onShow 立刻重拉 + 大段 setData，回包撞在返回动画里重排整页。返回本页时把刷新挪到返回动画之后。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { afterReturn, RETURN_SETTLE_MS } from '../lib/nav'
import orderListTs from '../pages/order-list/order-list.ts?raw'
import orderTs from '../pages/order/order.ts?raw'
import myCoursesTs from '../pages/my-courses/my-courses.ts?raw'
import aftersalesTs from '../pages/aftersales/aftersales.ts?raw'
import logisticsTs from '../pages/logistics/logistics.ts?raw'
import catalogTs from '../pages/catalog/catalog.ts?raw'
import checkoutTs from '../pages/checkout/checkout.ts?raw'
import meTs from '../pages/me/me.ts?raw'

let stack: object[] = []
beforeEach(() => {
  vi.useFakeTimers()
  stack = []
  ;(globalThis as any).getCurrentPages = () => stack
})
afterEach(() => vi.useRealTimers())

describe('afterReturn：返回本页的刷新等返回动画走完', () => {
  it('大白话：首次露面立刻拉（首屏要数据）；之后每次回到本页都等 0.35 秒再刷新', () => {
    const page = {}
    stack = [page]
    const fn = vi.fn()
    afterReturn(page, fn)
    expect(fn).toHaveBeenCalledTimes(1)
    afterReturn(page, fn)
    expect(fn).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(RETURN_SETTLE_MS - 1)
    expect(fn).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(fn).toHaveBeenCalledTimes(2)
    expect(RETURN_SETTLE_MS).toBeGreaterThanOrEqual(300) // 系统返回滑动约 250–300ms
  })
  it('大白话：等的这 0.35 秒里用户又离开了本页（已出栈）——不再刷新，不往已卸载的页 setData', () => {
    const page = {}
    stack = [page]
    const fn = vi.fn()
    afterReturn(page, fn)
    afterReturn(page, fn)
    stack = []
    vi.advanceTimersByTime(RETURN_SETTLE_MS)
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

describe('返回会重拉的页面都走 afterReturn', () => {
  it('大白话：订单列表/订单详情/我的课程/售后/物流/课程目录/确认订单/「我」的 onShow 刷新挪到返回动画之后', () => {
    for (const [name, src] of Object.entries({ orderListTs, orderTs, myCoursesTs, aftersalesTs, logisticsTs, catalogTs, checkoutTs, meTs })) {
      const at = src.search(/\n {2}(async )?onShow\(/)
      const onShow = src.slice(at, src.indexOf('\n  },', at))
      expect(onShow, name).toMatch(/afterReturn\(this, /)
    }
  })
})

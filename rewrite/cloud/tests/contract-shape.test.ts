// mp↔cloud 响应契约键集合哨兵（批B10·守卫 rw-app-response-contract·病根#5 手抄副本漂移 + #8 编译绿≠契约没漂）。
// 目的：mp 物理进不了 @ldrw/shared（微信开发者工具编译限制），响应形状全靠手抄——cloud 改键 mp 编译
// 不红＝静默漂移面。本文件对钱链/学习链 5 热 action（createOrder/pay/getMyOrders/getOrderById/
// getPlaybackUrl）的成功响应做 Object.keys 排序全等断言：增键/删键/改名都红，覆盖编译锁的盲区
// （加键 TS 宽赋值不红；createOrder 的 order:any 展开编译锁无牙）。
// 本测试红了＝契约动了：先同步 mp 手抄四消费点位——rewrite/mp/lib/payFlow.ts（收银台五参）/
// lib/mapOrders.ts（订单文档）/ lib/playbackCache.ts（r.url）/ pages/order-list/order-list.ts
// （nextCursor/hasMore）——再同步 rewrite/shared/src/contracts.ts 与本文件期望值。
// activateCourse 刻意不在此列：app-learning.test.ts 已有整形 toEqual({ok,state,courseId}) 全等断言。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as app } from '../src/functions/app/index'

const call = (action: string, data: Record<string, unknown> = {}) => app({ action, data }) as Promise<any>
const keysOf = (o: any) => Object.keys(o).sort()

const ADDR = { name: '张三', phone: '13800000000', region: '浙江·杭州', detail: 'xx 路 1 号' }
// 刻意不 seed cloud:// cover（cover 缺省快照成空串）：绕开 swapOrdersCover 换址与容器级签发缓存，
// 免 __resetTempUrlCacheForTest 跨用例纠缠——键集合与 cover 值无关，swapOrdersCover 不增删键。
const seedProducts = () => control.seed('products', [{ _id: 'p1', id: 'p1', name: '小鸭礼盒', price: 198, tag: '基础款' }])
const createMockOrder = () => call('createOrder', { items: [{ id: 'p1', qty: 1 }, { id: 'hook', qty: 1 }], address: ADDR })

const seedPendingOrder = (over: Record<string, unknown> = {}) =>
  control.seed('orders', [
    {
      _id: 'o1', id: 'o1', _openid: 'oME', status: 'pending', amount: 178,
      createdAt: Date.now(), items: [{ productId: 'p1', name: '小鸭礼盒', qty: 1 }], reserved: [],
      ...over,
    },
  ])
const seedRealPay = () => control.seed('config', [{ _id: 'pay', mode: 'real', flowId: 'flow-pay' }])

// 订单文档键集（mock 路径 13 键·含 payMode 条件键 paidAt）；real(pending) 路径为去 paidAt 的 12 键。
const ORDER_KEYS_MOCK = ['_id', '_openid', 'address', 'amount', 'coupon', 'createdAt', 'goods', 'id', 'items', 'paidAt', 'reserved', 'ship', 'status']
const ORDER_KEYS_REAL = ORDER_KEYS_MOCK.filter((k) => k !== 'paidAt')
const LINE_KEYS = ['cover', 'enteredQty', 'lineId', 'name', 'price', 'productId', 'qty', 'refundable', 'spec']

beforeEach(() => {
  control.reset()
  control.setOpenId('oME')
  process.env.ALLOW_MOCK_PAY = '1' // 测试环境显式放行 mock（生产永不设）
  seedProducts()
})
afterEach(() => {
  delete process.env.ALLOW_MOCK_PAY
})

describe('契约键集合哨兵（Object.keys 排序全等·增删改名都红）', () => {
  it('createOrder·mock 路径：顶层 [ok,order]；order 13 键含 paidAt；items 行 9 键（商品行与搭配购行同形）', async () => {
    const r = await createMockOrder()
    expect(r.ok).toBe(true)
    expect(keysOf(r)).toEqual(['ok', 'order'])
    expect(keysOf(r.order)).toEqual(ORDER_KEYS_MOCK)
    expect(keysOf(r.order.items[0])).toEqual(LINE_KEYS) // 商品行（products 分支）
    expect(keysOf(r.order.items[1])).toEqual(LINE_KEYS) // 搭配购行（ADDONS 分支·独立字面量构造点）
  })

  it('createOrder·real 路径：order 12 键无 paidAt——锁「paidAt 是 payMode 条件键」这一事实本身', async () => {
    control.seed('config', [{ _id: 'pay', mode: 'real', flowId: 'f' }])
    const r = await createMockOrder()
    expect(r.ok).toBe(true)
    expect(r.order.status).toBe('pending')
    expect(keysOf(r.order)).toEqual(ORDER_KEYS_REAL)
  })

  it('pay·收银台分支：顶层 [ok,payment]；payment 五参（payFlow.ts:31 硬编码五字段的哨兵本尊）', async () => {
    seedPendingOrder()
    seedRealPay()
    control.setCallFunctionResult({
      result: { data: { timeStamp: '1', nonceStr: 'n', packageVal: 'pkg=x', signType: 'RSA', paySign: 'sig' } },
    })
    const r = await call('pay', { id: 'o1' })
    expect(r.ok).toBe(true)
    expect(keysOf(r)).toEqual(['ok', 'payment'])
    expect(keysOf(r.payment)).toEqual(['nonceStr', 'package', 'paySign', 'signType', 'timeStamp'])
  })

  it('pay·0 元直付分支：顶层 [ok,paid,paidAt]', async () => {
    seedPendingOrder({ amount: 0 })
    seedRealPay()
    const r = await call('pay', { id: 'o1' })
    expect(r.ok).toBe(true)
    expect(keysOf(r)).toEqual(['ok', 'paid', 'paidAt'])
  })

  it('getMyOrders：顶层 [hasMore,list,nextCursor,ok]（末页 nextCursor 为 null 但键在·如实锁现状）；list 行＝订单 13 键', async () => {
    const c = await createMockOrder()
    expect(c.ok).toBe(true)
    const r = await call('getMyOrders')
    expect(r.ok).toBe(true)
    expect(keysOf(r)).toEqual(['hasMore', 'list', 'nextCursor', 'ok'])
    expect(r.nextCursor).toBe(null) // 键在值 null——mp order-list.ts 消费 nextCursor/hasMore
    expect(keysOf(r.list[0])).toEqual(ORDER_KEYS_MOCK)
  })

  it('getOrderById：顶层 [ok,order]；order 13 键', async () => {
    const c = await createMockOrder()
    expect(c.ok).toBe(true)
    const r = await call('getOrderById', { id: c.order.id })
    expect(r.ok).toBe(true)
    expect(keysOf(r)).toEqual(['ok', 'order'])
    expect(keysOf(r.order)).toEqual(ORDER_KEYS_MOCK)
  })

  it('getPlaybackUrl：素材未剪 url:null 与已授权换址两分支同为 [ok,url]（playbackCache.ts 消费 r.url）', async () => {
    control.seed('courses', [
      {
        _id: 'c1', id: 'c1', title: '课-c1', sort: 1,
        chapters: [
          {
            id: 'ch1', title: '第一章',
            lessons: [
              {
                id: 'l1', name: '第一节', dur: '10:00',
                segments: [
                  { id: 's1', name: '起针', dur: '5:00', videoFileId: 'cloud://v/c1-s1.mp4' },
                  { id: 's2', name: '长针', dur: '5:00', videoFileId: '' }, // 素材未剪
                ],
              },
            ],
          },
        ],
      },
    ])
    control.seed('activations', [{ _id: 'A1', _openid: 'oME', courseId: 'c1', qrcodeId: 'A1', code: 'A1', enteredAt: 111, createdAt: 1 }])

    const empty = await call('getPlaybackUrl', { courseId: 'c1', segmentId: 's2' })
    expect(empty.ok).toBe(true)
    expect(keysOf(empty)).toEqual(['ok', 'url'])
    expect(empty.url).toBe(null) // 未剪＝诚实 null（不是缺键）

    const signed = await call('getPlaybackUrl', { courseId: 'c1', segmentId: 's1' })
    expect(signed.ok).toBe(true)
    expect(keysOf(signed)).toEqual(['ok', 'url'])
    expect(typeof signed.url).toBe('string')
  })
})

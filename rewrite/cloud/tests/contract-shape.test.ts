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
// 第二批扩面键集（omp 交接工单#1·B10「按热度逐批扩」）：
// 售后行 16 键——刻意由 applyRefund 真写入后回读（不是测试自造 seed 回声），锁的是「写入方字段集」这个真契约。
const AFTERSALE_KEYS = ['_id', '_openid', 'addressName', 'appliedAt', 'itemTotal', 'lineId', 'name', 'orderId', 'outRefundNo', 'phone', 'productId', 'qty', 'reason', 'refundAmount', 'spec', 'status']
const REVIEW_KEYS = ['createdAt', 'name', 'photos', 'rating', 'spec', 'tags', 'text']
const SUMMARY_KEYS = ['approx', 'count', 'dist', 'score', 'tags']
const AS_ORDER = {
  _id: 'oR', id: 'oR', _openid: 'oME', status: 'paid', amount: 178, goods: 198, createdAt: 1000,
  address: { name: '张三', phone: '13800000000', region: '浙江·杭州', detail: 'xx 路 1 号' },
  items: [{ productId: 'p1', lineId: 'p1__基础款', spec: '基础款', name: '小鸭礼盒', price: 198, qty: 1, refundable: true }],
}

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

  // ── 第二批扩面（omp 交接工单#1）：四个读 action 补哨兵，写法照第一批 ──
  it('getCourses：顶层 [list,ok]；课程 3 键 / 章 3 键 / 节 4 键 / 段 4 键——段只投影 hasVideo 布尔，videoFileId 不出网关', async () => {
    control.seed('courses', [
      {
        _id: 'c1', id: 'c1', title: '钩织入门', sort: 1,
        chapters: [
          {
            id: 'ch1', title: '第一章',
            lessons: [
              { id: 'l1', name: '第一节', dur: '10:00', segments: [{ id: 's1', name: '起针', dur: '5:00', videoFileId: 'cloud://v/c1-s1.mp4' }] },
            ],
          },
        ],
      },
    ])
    const r = await call('getCourses')
    expect(r.ok).toBe(true)
    expect(keysOf(r)).toEqual(['list', 'ok'])
    const c = r.list[0]
    expect(keysOf(c)).toEqual(['chapters', 'id', 'title'])
    expect(keysOf(c.chapters[0])).toEqual(['id', 'lessons', 'title'])
    expect(keysOf(c.chapters[0].lessons[0])).toEqual(['dur', 'id', 'name', 'segments'])
    expect(keysOf(c.chapters[0].lessons[0].segments[0])).toEqual(['dur', 'hasVideo', 'id', 'name'])
    expect(c.chapters[0].lessons[0].segments[0].hasVideo).toBe(true) // 布尔投影：受保护 fileID 不随目录下发
  })

  it('getMyCourses：顶层 [list,ok]；行只 [courseId,enteredAt]——激活文档的 code/qrcodeId/_openid 一律不出网关', async () => {
    control.seed('activations', [{ _id: 'A1', _openid: 'oME', courseId: 'c1', qrcodeId: 'q1', code: 'K1', enteredAt: 111, createdAt: 1 }])
    const r = await call('getMyCourses')
    expect(r.ok).toBe(true)
    expect(keysOf(r)).toEqual(['list', 'ok'])
    expect(keysOf(r.list[0])).toEqual(['courseId', 'enteredAt'])
  })

  it('getMyAfterSales：顶层 [hasMore,list,nextCursor,ok]（同 getMyOrders 分页契约）；售后行 16 键由 applyRefund 真写入', async () => {
    control.seed('orders', [AS_ORDER])
    const a = await call('applyRefund', { orderId: 'oR', lineId: 'p1__基础款', reason: '尺寸不合适' })
    expect(a.ok).toBe(true)
    const r = await call('getMyAfterSales')
    expect(r.ok).toBe(true)
    expect(keysOf(r)).toEqual(['hasMore', 'list', 'nextCursor', 'ok'])
    expect(keysOf(r.list[0])).toEqual(AFTERSALE_KEYS)
  })

  it('getReviews：首页顶层 5 键含 summary；翻页 summary 键仍在（值 undefined·键集合不随页变）；评价行 7 键、summary 5 键——晒图只下发换好的临时地址', async () => {
    control.seed('reviews', [
      { _id: 'r1', productId: 'p1', _openid: 'oA', name: '小明', rating: 5, tags: ['手感好'], text: '很好', spec: '基础款', photos: [], createdAt: 200 },
      { _id: 'r2', productId: 'p1', _openid: 'oB', name: '小红', rating: 4, tags: [], text: '不错', spec: '基础款', photos: [], createdAt: 100 },
    ])
    const first = await call('getReviews', { productId: 'p1' })
    expect(first.ok).toBe(true)
    expect(keysOf(first)).toEqual(['hasMore', 'list', 'nextCursor', 'ok', 'summary'])
    expect(keysOf(first.list[0])).toEqual(REVIEW_KEYS)
    expect(keysOf(first.summary)).toEqual(SUMMARY_KEYS)

    // 翻页（复合游标 {v,id}）：summary 不重算，但键必须还在——mp 解构 r.summary 不能因页码不同而炸
    const next = await call('getReviews', { productId: 'p1', cursor: { v: 200, id: 'r1' } })
    expect(next.ok).toBe(true)
    expect(keysOf(next)).toEqual(['hasMore', 'list', 'nextCursor', 'ok', 'summary'])
    expect(next.summary).toBeUndefined()
  })
})

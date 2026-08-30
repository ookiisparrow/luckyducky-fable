// mp↔cloud 响应契约键集合哨兵（批B10 立·W1 收官扩至全覆盖·守卫 rw-app-response-contract·
// 病根#5 手抄副本漂移 + #8 编译绿≠契约没漂）。
// 目的：mp 物理进不了 @ldrw/shared（微信开发者工具编译限制），响应形状全靠手抄——cloud 改键 mp 编译
// 不红＝静默漂移面。本文件对 app 网关 **24 个 action** 的响应做 Object.keys 排序全等断言：增键/删键/
// 改名都红，覆盖编译锁的盲区（加键 TS 宽赋值不红；createOrder 的 order:any 展开编译锁无牙）。
// 覆盖面分三批（钱链/学习热链 5 个 → 第二批读 action 4 个 → W1 收官 15 个），**成功态与失败态都锁**：
// 带闸 action 失败时成功那半的键（list/items/user）会整个消失，mp 裸解构即 undefined，故失败态各自锁。
// 另有 confirmEnter/applyRefund 两个只作造数驱动被调用（推进状态），它们自身的键集不在本文件锁。
// 未覆盖（有意）：主力保留的钱链语义面 cancelOrder/confirmReceive，以及悬案 kfBind/submitCheckpointPhoto。
// 三类裁剪形态决定造数方式（W1 结论·照抄前先分清是哪类）：
//   ① 零裁剪透传（catalog/content/users/progress·{...doc} 整档下发）→ 键集由**写侧**单向决定，必须
//      「经真写侧写入 → 网关读回」；测试自造 seed 只锁得住自己的回声。
//   ② 白名单重建（getPublicFaq/getHelpVideos·逐字段 String() 重造）→ 往 seed 里**下毒**验脏字段进不来。
//   ③ 零载荷写（trackEvent/submitReview/submitFeedback·恒 ok()）→ 锁「写入字段集 ↔ 零下发」的对照。
// 本测试红了＝契约动了：先同步 mp 手抄消费点位——rewrite/mp/lib/payFlow.ts（收银台五参）/
// lib/mapOrders.ts（订单文档）/ lib/playbackCache.ts（r.url）/ pages/order-list/order-list.ts
// （nextCursor/hasMore）/ lib/mapDetail.ts / lib/mapLearning.ts——再同步 rewrite/shared/src/contracts.ts
// 与本文件期望值。
// activateCourse 的**首扫成功支**不在此列：app-learning.test.ts 已有整形 toEqual({ok,state,courseId})
// 全等断言；本文件只补它的 mine 支与三个失败态（见下方 W1·B 批那条用例）。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import cloud, { control } from 'wx-server-sdk'
import { main as app } from '../src/functions/app/index'
import { __resetTempUrlCacheForTest } from '../src/kit/storage'
import { saveHomeContent, savePageContent, saveHelpVideos } from '../src/functions/adminApi/actions/content'
import { publishCourse, saveCourseDraft } from '../src/functions/adminApi/actions/courses'
import { saveKb } from '../src/functions/adminApi/actions/kb'
import { saveDraft, publishProduct, unpublishProduct } from '../src/functions/adminApi/actions/products'
import { setReviewPicked } from '../src/functions/adminApi/actions/reviews'
import type { Ctx } from '../src/functions/adminApi/lib'

const call = (action: string, data: Record<string, unknown> = {}) => app({ action, data }) as Promise<any>
const keysOf = (o: any) => Object.keys(o).sort()

// 第三批（战役工单 W1·A 批）用：目录/内容面全是**零裁剪透传**（`{...doc}` 只改值不改键），响应键集
// 由**写侧白名单**单向决定。故这批哨兵一律「经真写侧写入 → 网关读回 → 键集全等」（同 AFTERSALE_KEYS
// 的写入方字段集范式），不用测试自造 seed——自造只锁得住自己的回声，锁不住写侧漂移。
// 桩的默认导出没有 database() 的类型声明（真 sdk 有）：一次性具名断言，不内联进成员访问。
const sdk = cloud as unknown as { database: () => Ctx['db'] }
const db = () => sdk.database()
const adminCtx = (data: unknown): Ctx => ({ db: db(), cloud, data, drafts: db().collection('productsDraft') })

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
// C 批（W1 收官）+ 先审后发：评价写侧 13 键——submitReview 的 add 字面量（含 picked:false）。
// getReviews 只下发其中 7 键（REVIEW_KEYS），差集 6 键＝_id/_openid/orderId/lineId/productId/picked
// 是归属、内部关联与挑选闸，绝不出公开网关。
const REVIEW_WRITE_KEYS = ['_id', '_openid', 'createdAt', 'lineId', 'name', 'orderId', 'photos', 'picked', 'productId', 'rating', 'spec', 'tags', 'text']
const FEEDBACK_WRITE_KEYS = ['_id', '_openid', 'category', 'contact', 'content', 'createdAt', 'page', 'platform', 'version']
const DONE_ORDER = {
  _id: 'oDone', id: 'oDone', _openid: 'oME', status: 'done', amount: 198, goods: 198, createdAt: 1000,
  address: { name: '张三', phone: '13800000000', region: '浙江·杭州', detail: 'xx 路 1 号' },
  items: [{ productId: 'p1', lineId: 'p1__基础款', spec: '基础款', name: '小鸭礼盒', price: 198, qty: 1, refundable: false }],
}
// 第三批扩面键集（战役工单 W1·A 批·目录/内容/FAQ 面）：
// 商品档 17 键——由 adminApi saveDraft→publishProduct 真写入后回读（publishProduct 的 doc 字面量＝
// products 集合的权威字段集）。app 侧 getProductDetail 整档透传出这 17 键；getProducts 列表瘦身删 images
// 后为 16 键（守卫 rw-catalog-list-cover-only 的测试半边）。这两条链路**零裁剪**：写侧加一个字段就直接
// 出公开网关（编译不红、既有值断言也不红），本哨兵是那条唯一的机器闸。
const PRODUCT_KEYS = ['_id', 'brief', 'courseId', 'cover', 'detailSections', 'featured', 'id', 'images', 'kit', 'name', 'params', 'price', 'skus', 'sort', 'tag', 'updatedAt', 'was']
const PRODUCT_LIST_KEYS = PRODUCT_KEYS.filter((k) => k !== 'images')
// 首页内容 14 键＝saveHomeContent 白名单 13 字段 + _id（_id/updatedAt 随公开读一并下发·如实锁现状）。
const HOME_KEYS = ['_id', 'activationBg', 'activationBgByCourse', 'brand', 'closing', 'faq', 'feature', 'footer', 'hero', 'loadingBg', 'reassure', 'reviews', 'trust', 'updatedAt']
const DRAFT = { id: 'pd1', name: '小鸭礼盒', tag: '基础款', price: '198', was: '258', brief: '零基础友好', cover: 'cloud://pd1-cover.jpg', images: ['cloud://pd1-a.jpg'], skus: [{ name: '基础款', price: '198' }], params: [['材质', '纯棉']], detailSections: [{ lead: '关于', body: '正文' }], kit: [{ name: '钩针', qty: '1 支' }], courseId: 'course-pd1' }
// 上架一份规范商品档（_id 刻意避开 beforeEach 的 seedProducts 那条 4 键残档——桩 seed 是 concat 追加、
// doc().get() 取首个匹配，同 _id 会命中残档，断言错乱且极难排查）。
const publishProduct1 = async () => {
  await saveDraft(adminCtx({ product: DRAFT }))
  const r = await publishProduct(adminCtx({ id: 'pd1' }))
  expect(JSON.parse(r.body).ok).toBe(true)
}

beforeEach(() => {
  control.reset()
  __resetTempUrlCacheForTest() // 清容器级签发缓存：第三批断言「cover/images 换成 https、fileID 不出网关」的值
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
    // 值非空（Issue #110 同类扫描）：getCourses 是逐层显式白名单投影——投影改读错字段时键集哨兵全绿、值静默 undefined
    expect(c.title).toBe('钩织入门')
    expect(c.chapters[0].title).toBe('第一章')
    expect(c.chapters[0].lessons[0].name).toBe('第一节')
    expect(c.chapters[0].lessons[0].dur).toBe('10:00')
    expect(c.chapters[0].lessons[0].segments[0].name).toBe('起针')
    expect(c.chapters[0].lessons[0].segments[0].dur).toBe('5:00')
  })

  it('getCourses·写→读闭环（Issue #110 同类扫描）：saveCourseDraft→publishCourse 真发布 → 目录读回标题/节名非空', async () => {
    // courses 公开目录是白名单投影、且上面那条哨兵全靠自造 seed（绕过写侧）——cleanCourse/publishCourse
    // 若改名 title/name 字段，seed 哨兵全绿而学员端目录静默变空白。经真写侧发布一份再读回，锁死两端。
    const draft = { id: 'cW', title: '进阶课', sort: 99, chapters: [{ id: 'chW', title: '第二章', lessons: [{ id: 'lW', name: '收针一节', dur: '8:00', segments: [{ id: 'sW', name: '藏线头', dur: '3:00', videoFileId: '' }] }] }] }
    expect(JSON.parse((await saveCourseDraft(adminCtx({ course: draft }))).body).ok).toBe(true)
    expect(JSON.parse((await publishCourse(adminCtx({ courseId: 'cW' }))).body).ok).toBe(true)
    const r = await call('getCourses')
    expect(r.ok).toBe(true)
    const c = r.list.find((x: any) => x.id === 'cW')
    // 写侧（cleanCourse 白名单）或读侧（publicChapter/publicLesson/publicSegment 投影）任一改名即红
    expect(c.title).toBe('进阶课')
    expect(c.chapters[0].title).toBe('第二章')
    expect(c.chapters[0].lessons[0].name).toBe('收针一节')
    expect(c.chapters[0].lessons[0].segments[0].name).toBe('藏线头')
  })

  it('getMyCourses：顶层 [list,ok]；行只 [courseId,enteredAt]——激活文档的 code/qrcodeId/_openid 一律不出网关', async () => {
    control.seed('activations', [{ _id: 'A1', _openid: 'oME', courseId: 'c1', qrcodeId: 'q1', code: 'K1', enteredAt: 111, createdAt: 1 }])
    const r = await call('getMyCourses')
    expect(r.ok).toBe(true)
    expect(keysOf(r)).toEqual(['list', 'ok'])
    expect(keysOf(r.list[0])).toEqual(['courseId', 'enteredAt'])
    expect(r.list[0]).toEqual({ courseId: 'c1', enteredAt: 111 }) // 值非空且如实（Issue #110 同类·byCourse 聚合读错字段时键集仍绿）
  })

  it('getMyCourses·写→读闭环（Issue #110 同类扫描）：activateCourse→confirmEnter 真进课 → 读回 courseId/enteredAt 非空', async () => {
    // 激活文档由 ensureActivation（app 写侧 add 字面量）落地——若它改名 courseId/enteredAt，自造 seed 的
    // 哨兵全绿、学员「我的课程」静默消失。走真进课链路读回，两端一起锁。
    control.seed('qrcodes', [{ _id: 'CODE9', code: 'CODE9', courseId: 'cW', status: 'unused', activatedBy: null, activatedAt: null, createdAt: 1 }])
    await call('activateCourse', { code: 'CODE9' })
    await call('confirmEnter', { code: 'CODE9' })
    const r = await call('getMyCourses')
    expect(r.ok).toBe(true)
    expect(r.list.length).toBe(1)
    expect(r.list[0].courseId).toBe('cW')
    expect(typeof r.list[0].enteredAt).toBe('number')
    expect(r.list[0].enteredAt).toBeGreaterThan(0)
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
      { _id: 'r1', productId: 'p1', picked: true, _openid: 'oA', name: '小明', rating: 5, tags: ['手感好'], text: '很好', spec: '基础款', photos: [], createdAt: 200 },
      { _id: 'r2', productId: 'p1', picked: true, _openid: 'oB', name: '小红', rating: 4, tags: [], text: '不错', spec: '基础款', photos: [], createdAt: 100 },
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

  // ── 第三批扩面（战役工单 W1·A 批：目录/内容/FAQ 五 action）──
  // 这组与前两批的差别：catalog/content 面**零裁剪透传**（`{...doc}` 只改值不改键），响应键集由写侧
  // 白名单单向决定。所以造数一律走真写侧（saveDraft→publishProduct / saveHomeContent / savePageContent），
  // 锁的是「写侧字段集 ↔ 公开下发面」这条端到端契约；自造 seed 只能锁住自己的回声。
  it('getProducts：顶层 [list,ok]；列表行 16 键＝商品档 17 键去 images（列表瘦身）；skus 行 2 键；cover 换 https——cloud:// fileID 不出网关', async () => {
    await publishProduct1()
    const r = await call('getProducts')
    expect(r.ok).toBe(true)
    expect(keysOf(r)).toEqual(['list', 'ok'])
    const row = r.list.find((p: any) => p._id === 'pd1') // 不靠顺序：桩 orderBy 对缺 sort 的档退化为 seed 序
    expect(keysOf(row)).toEqual(PRODUCT_LIST_KEYS)
    expect('images' in row).toBe(false) // 图册只在详情页下发（守卫 rw-catalog-list-cover-only 的测试半边）
    expect(keysOf(row.skus[0])).toEqual(['name', 'price'])
    expect(row.cover.startsWith('https://')).toBe(true) // 裸 fileID 不出网关：服务端换好临时址再下发
  })

  it('getProducts·空库：顶层键集不随有无数据变（[list,ok] 恒定·list 是诚实空数组不是缺键）', async () => {
    control.reset() // 连 beforeEach 的 seedProducts 一并清掉，验真空库
    const r = await call('getProducts')
    expect(r.ok).toBe(true)
    expect(keysOf(r)).toEqual(['list', 'ok'])
    expect(r.list).toEqual([])
  })

  it('getProductDetail：顶层 [ok,product]；product 17 键含 images（与列表相反）；images 逐项换 https；停售/无档 product:null 键仍在', async () => {
    await publishProduct1()
    const r = await call('getProductDetail', { id: 'pd1' })
    expect(r.ok).toBe(true)
    expect(keysOf(r)).toEqual(['ok', 'product'])
    expect(keysOf(r.product)).toEqual(PRODUCT_KEYS)
    expect(keysOf(r.product.skus[0])).toEqual(['name', 'price'])
    expect(keysOf(r.product.detailSections[0])).toEqual(['body', 'lead'])
    // kit 行 3 键：写侧 cleanProduct 恒造 {icon,name,qty}，mp mapDetail 只读 {name,qty}——锁写侧真形状，
    // 不锁消费面那半（少读不是契约，多下发才是；此处如实记录二者不一致）
    expect(keysOf(r.product.kit[0])).toEqual(['icon', 'name', 'qty'])
    expect(r.product.params).toEqual([['材质', '纯棉']]) // params 是 [k,v] 二元组数组，不是对象（mp mapDetail 按此消费）
    expect(r.product.images.every((u: string) => u.startsWith('https://'))).toBe(true)

    // 停售：同为 ok 响应、product 键在值 null（不是错误码、不是缺键——mp 据此走降级而非报错）
    await unpublishProduct(adminCtx({ id: 'pd1' }))
    const off = await call('getProductDetail', { id: 'pd1' })
    expect(keysOf(off)).toEqual(['ok', 'product'])
    expect(off.product).toBe(null)
  })

  it('getContent：顶层 [home,ok]；home 14 键由 saveHomeContent 真写入；嵌套逐层锁；无内容时 home:null 键仍在', async () => {
    await saveHomeContent(adminCtx({
      home: {
        hero: { title: '钩织', tagline: '从零开始', search: '搜点什么', img: 'cloud://hero.jpg' },
        brand: { name: '幸运鸭', lead: '自述' },
        feature: { title: '特写', body: '正文', img: 'cloud://feature.jpg' },
        reassure: { heading: '放心', lead: '引言', items: [{ icon: 'heart', title: '标题', body: '正文', img: 'cloud://re1.jpg' }] },
        reviews: { heading: '买家秀', items: [{ quote: '好评', user: '小明', img: 'cloud://rv1.jpg' }] },
        closing: { title: '收尾', cta: '开始', img: 'cloud://closing.jpg' },
        footer: { links: ['关于'], copy: '© LD' },
        activationBg: 'cloud://act.jpg', loadingBg: 'cloud://loading.jpg',
        activationBgByCourse: { c1: { welcome: 'cloud://c1-w.jpg' } },
        trust: [{ icon: 'shield', label: '正品' }],
        faq: [{ title: '问', body: '答' }],
      },
    }))
    const r = await call('getContent')
    expect(r.ok).toBe(true)
    expect(keysOf(r)).toEqual(['home', 'ok'])
    expect(keysOf(r.home)).toEqual(HOME_KEYS)
    expect(keysOf(r.home.hero)).toEqual(['img', 'search', 'tagline', 'title'])
    expect(keysOf(r.home.reassure)).toEqual(['heading', 'items', 'lead'])
    expect(keysOf(r.home.reassure.items[0])).toEqual(['body', 'icon', 'img', 'title'])
    expect(keysOf(r.home.reviews.items[0])).toEqual(['img', 'quote', 'user'])
    expect(keysOf(r.home.footer)).toEqual(['copy', 'links'])
    expect(keysOf(r.home.trust[0])).toEqual(['icon', 'label'])
    expect(keysOf(r.home.faq[0])).toEqual(['body', 'title'])
    // 换址口径两半，一并钉住：五处 img 换成 https；activationBg/loadingBg **刻意不换**、裸 fileID 原样下发
    expect(r.home.hero.img.startsWith('https://')).toBe(true)
    expect(r.home.reassure.items[0].img.startsWith('https://')).toBe(true)
    expect(r.home.activationBg).toBe('cloud://act.jpg')
    expect(r.home.loadingBg).toBe('cloud://loading.jpg')

    control.reset()
    const empty = await call('getContent')
    expect(keysOf(empty)).toEqual(['home', 'ok']) // 无内容：键集不变、值诚实 null（mp 据此回退默认文案）
    expect(empty.home).toBe(null)
  })

  it('getPageContent：顶层恒 3 键 [content,ok,page]（有档/无档/未知 page 三态各自锁）；about 档 4 键由 savePageContent 真写入', async () => {
    await savePageContent(adminCtx({ page: 'about', data: { lead: '你好', sections: [{ title: '关于', body: '正文' }] } }))
    const r = await call('getPageContent', { page: 'about' })
    expect(r.ok).toBe(true)
    expect(keysOf(r)).toEqual(['content', 'ok', 'page'])
    expect(r.page).toBe('about') // page 是入参回显——mp 按它对号入座，不能悄悄不回
    expect(keysOf(r.content)).toEqual(['_id', 'lead', 'sections', 'updatedAt'])
    expect(keysOf(r.content.sections[0])).toEqual(['body', 'title'])

    const missing = await call('getPageContent', { page: 'welcome' }) // 有白名单无档
    expect(keysOf(missing)).toEqual(['content', 'ok', 'page'])
    expect(missing.content).toBe(null)

    const bad = await call('getPageContent', { page: 'evilPage' }) // 白名单外 fail-closed
    expect(keysOf(bad)).toEqual(['error', 'ok', 'page'])
    expect(bad.ok).toBe(false)
  })

  it('getPublicFaq：顶层 [items,ok]（空态同形）；kb 管理元数据与库内脏字段一律不出网关——白名单重建而非展开删', async () => {
    // 行键集 {key,title,content} 已由 app-reviews.test.ts 整形 toEqual 锁死，此处不重复；补的是顶层键集、
    // 空态形状，以及「白名单重建」这个语义——往库里下毒塞白名单外字段，证明它们物理上进不来。
    control.seed('kb', [{
      _id: 'logistics:eta', question: '什么时候发货？', answer: '48 小时内。',
      category: 'logistics', order: 0, enabled: true, featured: true, updatedAt: 1000,
      _openid: 'oADMIN', internalNote: '内部备注', reviewStatus: 'pending', // 下毒：白名单外字段
    }])
    const r = await call('getPublicFaq')
    expect(r.ok).toBe(true)
    expect(keysOf(r)).toEqual(['items', 'ok'])
    expect(keysOf(r.items[0])).toEqual(['content', 'key', 'title'])
    // 值非空（Issue #110）：白名单重建 String(d.x||'') 的兜底会把「写侧字段改名」静默降级成空串，键集
    // 哨兵对此天然失明（输出键恒在、值恒 string）——读侧投影漂移由值断言咬住；写侧改名由下一条真写入
    // 链路用例专治。
    expect(r.items[0].key).toBe('logistics:eta')
    expect(r.items[0].title).toBe('什么时候发货？')
    expect(r.items[0].content).toBe('48 小时内。')
    // 逐键否定（不用 JSON.stringify includes：'order' 这类短词会被答案正文里的字样喂假绿/假红）
    for (const leak of ['category', 'order', 'enabled', 'updatedAt', 'featured', '_openid', 'internalNote', 'reviewStatus']) {
      expect(leak in r.items[0]).toBe(false)
    }

    control.reset()
    const empty = await call('getPublicFaq')
    expect(keysOf(empty)).toEqual(['items', 'ok']) // 空态：items 键恒在、值空数组（不是缺键）
    expect(empty.items).toEqual([])
  })

  it('getPublicFaq·写→读闭环（Issue #110）：saveKb 真写入 → 公开读回 title/content 非空——「写侧改名静默降级」的专治断言', async () => {
    // 经真写侧 adminApi saveKb 落库，不自造 seed——自造 seed 只锁得住自己的回声：saveKb 若把
    // question/answer 改名，键集哨兵全绿而顾客端内容变空串。本条把写侧字段集与读回值两头一起锁死
    // （同 REVIEW_WRITE_KEYS 范式），kb 单源的另一个消费面（cs bot faqAnswer 读 d.answer）随之同受保护。
    const saved = await saveKb(adminCtx({
      entries: [{ key: 'logistics:eta', question: '什么时候发货？', answer: '48 小时内。', category: 'logistics', order: 0, featured: true }],
    }))
    expect(JSON.parse(saved.body).ok).toBe(true)
    // 写侧字段集（真写入回读）：question/answer/featured 任一改名，这里先红
    expect(keysOf(control.dump('kb')[0])).toEqual(['_id', 'answer', 'category', 'enabled', 'featured', 'order', 'question', 'updatedAt'])
    const r = await call('getPublicFaq')
    expect(r.ok).toBe(true)
    expect(r.items.length).toBe(1)
    // 读回值逐字等于所存内容：两侧任一改名（写侧不存 question / 读侧不读 question）都到不了这句绿
    expect(r.items[0]).toEqual({ key: 'logistics:eta', title: '什么时候发货？', content: '48 小时内。' })
  })

  // ── 第三批扩面（战役工单 W1·B 批：学习链 + 用户面五 action）──
  // users/progress 两个集合的读侧同样**零裁剪透传**（`{...doc}` / `res.data` 整档下发），键集由写侧
  // 单向决定；故一律先走真写入方（login / updateProfile / trackEvent 本身）再读回。
  // 与 A 批的差别：这批多数带闸（withOpenId + withRateLimit），失败态的键集与成功态**不同形**
  // （成功的 list/user 键在失败时整个消失），mp 若裸解构就会拿到 undefined——失败态因此也要各自锁。
  it('login：顶层 [isNew,ok,user]；首登 user 6 键且**不带 unionid**（库里已写·响应是写前快照）；再登才 7 键——锁这条时序契约', async () => {
    control.reset()
    control.setOpenId('oNEW')
    control.setUnionId('uni-1')
    const first = await call('login')
    expect(first.ok).toBe(true)
    expect(first.isNew).toBe(true)
    expect(keysOf(first)).toEqual(['isNew', 'ok', 'user'])
    expect(keysOf(first.user)).toEqual(['_id', '_openid', 'avatar', 'createdAt', 'nickname', 'phone'])
    // 时序契约：storeUnionId 在 ok() 之前写库，但 user 是写前的对象引用——库里有、首登响应里没有。
    // 这条极易被"顺手改成写完再读回"破坏，破坏后 mp 首登拿到的 user 会多一个键。
    expect('unionid' in first.user).toBe(false)
    expect(control.dump('users')[0].unionid).toBe('uni-1')

    const again = await call('login')
    expect(again.isNew).toBe(false)
    expect(keysOf(again)).toEqual(['isNew', 'ok', 'user'])
    expect(keysOf(again.user)).toEqual(['_id', '_openid', 'avatar', 'createdAt', 'nickname', 'phone', 'unionid'])
  })

  it('login·未登录：[error,ok] 两键——user/isNew 整个消失（mp 裸解构 r.user 会拿 undefined，故失败态也要锁）', async () => {
    control.setOpenId('')
    const r = await call('login')
    expect(keysOf(r)).toEqual(['error', 'ok'])
    expect(r.error).toBe('NO_OPENID')
  })

  it('updateProfile：顶层 [ok,user]；user 是整档透传（写侧字段直出用户端网关·如实锁零裁剪）；未知字段丢弃既不入库也不下发；空补丁 [error,ok]', async () => {
    await call('login') // 先真建档（beforeEach 已 setOpenId('oME')）
    const r = await call('updateProfile', { nickname: '小鸭', bio: '钩织爱好者', phone: '13800000000', isAdmin: true, hack: '注入' })
    expect(r.ok).toBe(true)
    expect(keysOf(r)).toEqual(['ok', 'user'])
    // login 建档 6 键 + bio + updatedAt＝8 键。白名单外的 isAdmin/hack 既不入库也不出网关
    expect(keysOf(r.user)).toEqual(['_id', '_openid', 'avatar', 'bio', 'createdAt', 'nickname', 'phone', 'updatedAt'])
    expect('isAdmin' in r.user).toBe(false) // isAdmin 是 withAdminGate 的判定字段——白名单挡住提权自封
    expect('hack' in r.user).toBe(false)
    expect(control.dump('users')[0].isAdmin).toBeUndefined()
    // 零裁剪的另一半如实钉住：_openid 与 phone 确实随本人档下发（mp profile-edit 回填要用）
    expect(r.user._openid).toBe('oME')
    expect(r.user.phone).toBe('13800000000')

    const empty = await call('updateProfile', { avatar: 'https://evil.example/x.png' }) // 非 cloud:// 一律剔除 → 补丁空
    expect(keysOf(empty)).toEqual(['error', 'ok'])
    expect(empty.error).toBe('EMPTY_PATCH')
  })

  it('getMyProgress：顶层 [list,ok]；行 7 键由 trackEvent 真写入回读（不是自造 seed）；last 4 键；未登录时 list 键整个消失', async () => {
    control.seed('qrcodes', [{ _id: 'CODE1', code: 'CODE1', courseId: 'c1', status: 'unused', activatedBy: null, activatedAt: null, createdAt: 1 }])
    await call('activateCourse', { code: 'CODE1' })
    await call('confirmEnter', { code: 'CODE1' }) // 未确认进课的进度事件不折叠，必须先进课
    await call('trackEvent', { type: 'segment_done', targetId: 's1', page: 'player', meta: { courseId: 'c1', lessonId: 'l1', at: 30, dur: 60 } })

    const r = await call('getMyProgress')
    expect(r.ok).toBe(true)
    expect(keysOf(r)).toEqual(['list', 'ok'])
    expect(keysOf(r.list[0])).toEqual(['_id', '_openid', 'courseId', 'createdAt', 'done', 'last', 'updatedAt'])
    expect(keysOf(r.list[0].last)).toEqual(['at', 'dur', 'lessonId', 'segmentId'])
    expect(r.list[0].done.s1).toBe(true) // done 是 segmentId→true 的映射对象，不是数组（mp 按此消费）
    expect(r.list[0]._openid).toBe('oME') // 零裁剪：本人档的 _openid 随行下发（如实锁现状）

    control.setOpenId('')
    const anon = await call('getMyProgress')
    expect(keysOf(anon)).toEqual(['error', 'ok']) // 失败态 list 键消失，与成功态不同形
  })

  it('trackEvent：三条成功路径响应恒 [ok] 零载荷；events 写入 7 键含 _openid 但一个字节都不下发；NO_TYPE/META_TOO_BIG 各 [error,ok]', async () => {
    // ① 普通事件（只记流水）② 进度事件但未进课（防刷·不折叠，提前 return）③ 进度事件且已进课（折叠写 progress）
    // ——三条路径都必须同形 [ok]：mp 是 fire-and-forget，服务端刻意不回数据，回什么都算契约变更
    const plain = await call('trackEvent', { type: 'page_view', page: 'home' })
    expect(keysOf(plain)).toEqual(['ok'])
    const notEntered = await call('trackEvent', { type: 'segment_done', targetId: 's1', meta: { courseId: 'c1' } })
    expect(keysOf(notEntered)).toEqual(['ok'])
    expect(control.dump('progress').length).toBe(0) // 未进课不折叠（流水仍记）

    control.seed('activations', [{ _id: 'A1', _openid: 'oME', courseId: 'c1', qrcodeId: 'A1', code: 'A1', enteredAt: 111, createdAt: 1 }])
    const folded = await call('trackEvent', { type: 'segment_done', targetId: 's1', meta: { courseId: 'c1', lessonId: 'l1' } })
    expect(keysOf(folded)).toEqual(['ok'])

    // 写侧↔下发面对照：库里逐条带 _openid（归属字段），响应零载荷——这是本 action「敏感字段不出网关」的形态
    expect(keysOf(control.dump('events')[0])).toEqual(['_id', '_openid', 'createdAt', 'meta', 'page', 'targetId', 'type'])

    expect(keysOf(await call('trackEvent', {}))).toEqual(['error', 'ok']) // NO_TYPE
    expect(keysOf(await call('trackEvent', { type: 'x', meta: { blob: 'a'.repeat(2000) } }))).toEqual(['error', 'ok']) // META_TOO_BIG
  })

  it('activateCourse：mine 支与三个失败态各自锁键集——他人占用只带 courseId，activatedBy（别人的 openid）绝不出网关', async () => {
    // 首扫成功支已由 app-learning.test.ts 整形 toEqual 锁死，此处不重复；补的是 mine 支与失败态。
    control.seed('qrcodes', [{ _id: 'CODE1', code: 'CODE1', courseId: 'c1', status: 'unused', activatedBy: null, activatedAt: null, createdAt: 1 }])
    await call('activateCourse', { code: 'CODE1' })
    await call('confirmEnter', { code: 'CODE1' })
    const mine = await call('activateCourse', { code: 'CODE1' })
    expect(keysOf(mine)).toEqual(['courseId', 'ok', 'state'])
    expect(mine.state).toBe('mine')

    control.setOpenId('oOTHER')
    const taken = await call('activateCourse', { code: 'CODE1' })
    expect(keysOf(taken)).toEqual(['courseId', 'error', 'ok'])
    expect(taken.error).toBe('CODE_TAKEN')
    expect('activatedBy' in taken).toBe(false) // 占用者 openid 不外泄给扫码的陌生人

    expect(keysOf(await call('activateCourse', { code: 'NOPE' }))).toEqual(['error', 'ok']) // 无档：不带 courseId

    // 网关层限流响应形状（throttle.test.ts 锁的是装饰器单测·不经网关）：activateCourse 是 max 10/60s，
    // 本用例此前已在 oOTHER 名下调过两次，故这里只是"连打到超阈"，不宣称第几次撞——阈值本身是 throttle
    // 的契约、有它自己的测试，本哨兵只锁撞闸后的响应形状。选它而非 trackEvent（max 60）纯为省调用次数。
    for (let i = 0; i < 10; i++) await call('activateCourse', { code: '' })
    const limited = await call('activateCourse', { code: '' })
    expect(keysOf(limited)).toEqual(['error', 'ok'])
    expect(limited.error).toBe('RATE_LIMITED')
  })

  // ── 第三批扩面（战役工单 W1·C 批收官：评价/帮助视频/反馈/授权五 action）──
  // 这批与 A/B 又不同：多数是**白名单重建**（逐字段 String() 重造）或**零载荷写**，天然挡住写侧脏字段。
  // 所以锁点从「防透传」转成两条：① 重建出来的键集本身；② 写侧字段集 ↔ 下发面的差集（谁被裁了）。
  it('submitReview→getReviews 端到端：写侧 13 键真写入（含 picked:false）；未挑选公开读空；挑过才下发 7 键——_openid/orderId/lineId/productId/_id/picked 不出网关', async () => {
    control.seed('orders', [DONE_ORDER])
    control.seed('users', [{ _id: 'oME', _openid: 'oME', nickname: '幸运鸭' }])
    const s = await call('submitReview', { orderId: 'oDone', lineId: 'p1__基础款', rating: 5, text: '很好', tags: ['手感好'], photos: ['cloud://rev-a.jpg'] })
    expect(keysOf(s)).toEqual(['ok']) // 成功零载荷（同 trackEvent：写类 action 刻意不回数据）

    // 写侧字段集（真写入回读·不是自造 seed）
    const written = control.dump('reviews')[0]
    expect(keysOf(written)).toEqual(REVIEW_WRITE_KEYS)
    expect(written.picked).toBe(false)
    expect((await call('getReviews', { productId: 'p1' })).list).toEqual([]) // 未挑选不上墙

    const pick = await setReviewPicked(adminCtx({ id: written._id, picked: true }))
    expect(JSON.parse(pick.body).ok).toBe(true)
    // 读侧下发面：既有 getReviews 用例造的是 seed 回声，这条是端到端——写侧加字段若被顺手放进读侧映射即红
    const r = await call('getReviews', { productId: 'p1' })
    expect(keysOf(r.list[0])).toEqual(REVIEW_KEYS)
    for (const cut of ['_id', '_openid', 'orderId', 'lineId', 'productId', 'picked']) {
      expect(cut in r.list[0]).toBe(false)
    }
    expect(r.list[0].photos[0].startsWith('https://')).toBe(true) // 晒图裸 fileID 不出网关，换短时址下发
    // 值非空（Issue #110 同类扫描）：读侧 text/spec 走 `||''` 兜底，submitReview 写侧改名会静默降级成空串——
    // 真写入的内容必须原样读回（name←users.nickname / spec←订单行快照）
    expect(r.list[0].text).toBe('很好')
    expect(r.list[0].name).toBe('幸运鸭')
    expect(r.list[0].spec).toBe('基础款')

    // 失败态：本 action 9 个 err 全是裸 err(code)，一律两键（对照 activateCourse 的 CODE_TAKEN 带 courseId）
    expect(keysOf(await call('submitReview', { orderId: 'oDone', lineId: 'p1__基础款', rating: 5 }))).toEqual(['error', 'ok']) // REVIEWED 幂等
    expect(keysOf(await call('submitReview', { orderId: 'oDone', lineId: 'p1__基础款', rating: 9 }))).toEqual(['error', 'ok']) // BAD_RATING
  })

  it('getRatingSummary：扁平 3 键 [count,ok,score]——与 getReviews 的嵌套 summary 刻意不同形（同一个 mp mapSummary 吃两种形状）；无评价时键仍在、score 是字符串 0', async () => {
    control.seed('reviews', [
      { _id: 'r1', productId: 'p1', picked: true, _openid: 'oA', name: '小明', rating: 5, tags: [], text: '好', spec: '基础款', photos: [], createdAt: 200 },
      { _id: 'r2', productId: 'p1', picked: true, _openid: 'oB', name: '小红', rating: 4, tags: [], text: '不错', spec: '基础款', photos: [], createdAt: 100 },
    ])
    const r = await call('getRatingSummary', { productId: 'p1' })
    expect(r.ok).toBe(true)
    expect(keysOf(r)).toEqual(['count', 'ok', 'score'])
    expect(r.count).toBe(2)
    expect(r.score).toBe('4.5') // 字符串一位小数（mp 直接显示，不再格式化）
    // 两个"摘要"刻意不同形（详情页 slim 扁平 3 键 vs 列表页嵌套 summary 5 键·共用 mp mapSummary）：
    // 钉「score/count 直接挂顶层、不套 summary」——哪天有人把两者"统一"成嵌套，这里红并提醒同步 mp。
    expect('summary' in r).toBe(false)
    // 同一份数据经 getReviews 走的是另一条实现（buildSummaryExact），键集多 approx/dist/tags
    const viaList = await call('getReviews', { productId: 'p1' })
    expect(keysOf(viaList.summary)).toEqual(SUMMARY_KEYS)
    expect(viaList.summary.score).toBe(r.score) // 两条独立实现的均分口径必须一致（漂了就是真 bug）

    // 零评价：键全在、值是 count:0 / score:'0'（字符串），不是 null 也不是缺键——mp 据此判不渲染假评
    const none = await call('getRatingSummary', { productId: 'no-such' })
    expect(keysOf(none)).toEqual(['count', 'ok', 'score'])
    expect(none.count).toBe(0)
    expect(none.score).toBe('0')

    expect(keysOf(await call('getRatingSummary', {}))).toEqual(['error', 'ok']) // 缺 productId：score/count 整个消失
  })

  it('getHelpVideos：顶层 [items,ok]；主题 5 键 / 小段 4 键（两级白名单重建·写侧脏字段进不来）；videoFileId 换成 url——受保护 fileID 不出网关', async () => {
    await saveHelpVideos(adminCtx({
      items: [{
        id: 'h1', title: '新手入门', sub: '副标题', desc: '说明',
        // 下毒：白名单外字段（写侧重建即挡掉，两级都验）
        secret: '内部备注',
        segments: [{ id: 's1', name: '起针', dur: '5:00', videoFileId: 'cloud://help-s1.mp4', internal: 'x' }],
      }],
    }))
    const r = await call('getHelpVideos')
    expect(r.ok).toBe(true)
    expect(keysOf(r)).toEqual(['items', 'ok'])
    expect(keysOf(r.items[0])).toEqual(['desc', 'id', 'segments', 'sub', 'title'])
    expect(keysOf(r.items[0].segments[0])).toEqual(['dur', 'id', 'name', 'url'])
    expect('videoFileId' in r.items[0].segments[0]).toBe(false) // 换成 url 下发，裸 fileID 只在服务端
    expect(r.items[0].segments[0].url.startsWith('https://')).toBe(true)
    expect(JSON.stringify(r).includes('内部备注')).toBe(false)
    // 值非空（Issue #110 同类扫描）：两级 String(x||'') 重建对字段改名会静默降级成空串——本支已走真写侧
    // （saveHelpVideos）落库，所存 title/sub/desc/段名必须原样读回，两侧任一改名即红
    expect([r.items[0].title, r.items[0].sub, r.items[0].desc]).toEqual(['新手入门', '副标题', '说明'])
    expect(r.items[0].segments[0].name).toBe('起针')

    // url:null 分支只能自造 seed：写侧 saveHelpVideos 会 filter 掉无 videoFileId 的小段，真写入方造不出
    control.reset()
    control.seed('content', [{ _id: 'helpVideos', items: [{ id: 'h2', title: '空片', sub: '', desc: '', segments: [{ id: 's9', name: '未剪', dur: '', videoFileId: '' }] }] }])
    const nullUrl = await call('getHelpVideos')
    expect(keysOf(nullUrl.items[0].segments[0])).toEqual(['dur', 'id', 'name', 'url'])
    expect(nullUrl.items[0].segments[0].url).toBe(null) // 诚实 null，不是缺键

    control.setOpenId('')
    expect(keysOf(await call('getHelpVideos'))).toEqual(['error', 'ok']) // 未登录：items 键整个消失
  })

  it('submitFeedback：成功恒 [ok] 零载荷；写侧 9 键含 _openid 与用户自填 contact，一个字节都不下发；空内容/未登录各 [error,ok]', async () => {
    const r = await call('submitFeedback', { content: '很好用', category: 'idea', contact: 'wx: duck', page: 'feedback', version: 'rw-m2', platform: 'mp' })
    expect(keysOf(r)).toEqual(['ok'])
    // contact 是本 action 唯一 PII 类字段（用户自填微信号/手机号）：入库有、下发面为空
    expect(keysOf(control.dump('feedback')[0])).toEqual(FEEDBACK_WRITE_KEYS)
    expect(control.dump('feedback')[0]._openid).toBe('oME') // 归属取云端可信身份，不认前端传的

    expect(keysOf(await call('submitFeedback', { content: '   ' }))).toEqual(['error', 'ok']) // EMPTY_FEEDBACK
    control.setOpenId('')
    expect(keysOf(await call('submitFeedback', { content: 'x' }))).toEqual(['error', 'ok']) // NO_OPENID
  })

  it('dataConsent：顶层 [agreed,ok]，授权与撤授权同形只差值；库里存 {agreed,at} 凭证——且它会随 updateProfile 的整档透传出网关（零裁剪的连锁后果·如实锁）', async () => {
    const on = await call('dataConsent', { agree: true })
    expect(keysOf(on)).toEqual(['agreed', 'ok'])
    expect(on.agreed).toBe(true)
    const off = await call('dataConsent', { agree: false }) // 撤回：同形只差值（mp 按 agreed 布尔切换开关）
    expect(keysOf(off)).toEqual(['agreed', 'ok'])
    expect(off.agreed).toBe(false)

    // 写侧凭证：响应只回一个布尔，库里存的是带时间戳的凭证对象（响应不带 at——撤回时间不下发）
    const u = control.dump('users')[0]
    expect(keysOf(u.csDataShare)).toEqual(['agreed', 'at'])
    expect('at' in off).toBe(false)

    // 连锁事实：users 是零裁剪透传面，csDataShare 一旦落库就会随 updateProfile/login 出网关。
    // 这条不是背书、是把风险钉成可见断言——哪天 users 读侧改成白名单投影，这里会红并提醒同步 mp。
    const p = await call('updateProfile', { nickname: '小鸭' })
    expect(keysOf(p.user)).toEqual(['_id', '_openid', 'createdAt', 'csDataShare', 'nickname', 'updatedAt'])

    control.setOpenId('')
    expect(keysOf(await call('dataConsent', { agree: true }))).toEqual(['error', 'ok']) // 未登录：agreed 键消失
  })
})

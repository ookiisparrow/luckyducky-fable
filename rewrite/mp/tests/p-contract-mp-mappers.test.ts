// 小程序映射层 ↔ app 网关真实响应（Issue #400）：喂的是 tests/contracts/ 下 app-orders.json、app-shop-learning.json 的 sample——
// 它们由云端 p-contract-admin-shape.test.ts / p-contract-app-shape.test.ts 对着真 app 网关整体全等锁住，不是手写 fixture。
// 云端改键或改值，云端测试先红，改契约后这里再红，逼着映射层跟上。
import { describe, it, expect } from 'vitest'
import RAW from '../../../tests/contracts/app-orders.json?raw'
import SHOP_RAW from '../../../tests/contracts/app-shop-learning.json?raw'
import { mapOrder, mapOrders } from '../lib/mapOrders'
import { mapAfterSales, applicableLines } from '../lib/mapAftersales'
import { mapPayResult } from '../lib/payFlow'
import { mapProducts } from '../lib/mapHome'
import { mapDetail } from '../lib/mapDetail'
import { mapReviews, mapSummary } from '../lib/mapReviews'
import { activationView, mapMyCourses, mapCatalog } from '../lib/mapLearning'

const S = (name: string) => JSON.parse(RAW).cases[name].sample
const T = (name: string) => JSON.parse(SHOP_RAW).cases[name].sample
const A = '2026070112000001' // 已发货
const B = '2026070112000002' // 已全额退款
const C = '2026070112000003' // 少付 100 元的支付异常单
const D = '2026070112000004' // 售后待审核

describe('订单映射（getOrderById / getMyOrders 真实形状）', () => {
  it('已发货单：物流从 shipping 子对象取、状态「待收货」、金额两位小数', () => {
    const vm = mapOrder(S('getOrderById').order)!
    expect(vm).toMatchObject({
      id: A,
      statusLabel: '待收货',
      amountTitle: '实付款',
      amountLabel: '¥198.00',
      trackingNo: 'SF001',
      shipCompany: '顺丰',
      count: 1,
      goodsLabel: '¥198.00',
      shipLabel: '包邮',
    })
    expect(vm.shippedAtLabel).not.toBe('')
    expect(vm.items).toEqual([{ lineId: 'p1__', name: '小鸭礼盒', spec: '', priceLabel: '¥198.00', qty: 1, enteredQty: 0, refundable: true, reviewed: false, cover: '' }])
  })

  it('列表：一单不丢；支付异常单显示实际到账 ¥100.00，不是标价', () => {
    const r = S('getMyOrders')
    expect(r.hasMore).toBe(false)
    expect(mapOrders(r.list).map((v) => v.id)).toEqual([D, C, B, A])
    expect(mapOrders(r.list).find((v) => v.id === C)).toMatchObject({ statusLabel: '支付异常', amountTitle: '实付款', amountLabel: '¥100.00' })
  })
})

describe('售后映射（getMyAfterSales 真实形状）', () => {
  it('状态中文、退款额两位小数；已申请过的行按 lineId 对上订单行，不再出现在可申请列表', () => {
    const list = mapAfterSales(S('getMyAfterSales').list)
    expect(list.map((a) => [a.orderId, a.statusLabel, a.refundAmountLabel])).toEqual([
      [D, '申请中', '¥198.00'],
      [B, '已退款', '¥198.00'],
    ])
    const d = mapOrder(S('getMyOrders').list.find((o: { id: string }) => o.id === D))!
    const appliedD = list.filter((a) => a.orderId === D).map((a) => a.lineId)
    expect(applicableLines(d.status, d.items, appliedD)).toEqual([])
    expect(applicableLines(d.status, d.items, [])).toHaveLength(1) // 没申请过就能选
  })
})

describe('收银台（pay 真实形状）', () => {
  it('五参齐全才拉起收银台；工作流回的 packageVal 到这里已是 package', () => {
    expect(mapPayResult(T('pay'))).toEqual({
      kind: 'request',
      payment: { timeStamp: '1782878400', nonceStr: 'n0nce', package: 'prepay_id=wx01', signType: 'RSA', paySign: 'sig==' },
    })
  })
})

describe('商品映射（getProducts / getProductDetail 真实形状）', () => {
  it('列表卡：封面已是换好的 https 地址，价和划线价按元标', () => {
    expect(mapProducts(T('getProducts').list)).toEqual([
      { id: 'p1', name: '小棉鸭钩织礼盒', tag: '基础款', priceLabel: '¥198.00', wasLabel: '¥258.00', cover: 'https://tmp/cloud://env/p1-cover.jpg' },
    ])
  })

  it('详情：封面领衔图册、SKU/参数/详情段/材料清单/销量都取得到', () => {
    expect(mapDetail(T('getProductDetail').product)).toEqual({
      id: 'p1',
      name: '小棉鸭钩织礼盒',
      tag: '基础款',
      brief: '零基础友好',
      gallery: ['https://tmp/cloud://env/p1-cover.jpg', 'https://tmp/cloud://env/p1-a.jpg'],
      price: 198,
      was: 258,
      priceLabel: '¥198.00',
      wasLabel: '¥258.00',
      skus: [{ name: '基础款', price: 198, priceLabel: '¥198.00' }],
      params: [{ k: '材质', v: '纯棉' }],
      sections: [{ lead: '关于', body: '正文' }],
      kit: [{ name: '钩针', qty: '1 支' }],
      soldLabel: '已售 128',
    })
  })
})

describe('评价映射（getReviews / getRatingSummary 真实形状）', () => {
  it('评价行：昵称、星级、标签、规格；汇总头：均分、条数、分布、标签', () => {
    const r = T('getReviews')
    const [row] = mapReviews(r.list)
    expect(row).toMatchObject({ name: '鸭鸭', stars: '★★★★★', rating: 5, tags: ['手感好'], text: '好上手', spec: '基础款', photos: [] })
    expect(row.timeLabel).not.toBe('')
    expect(mapSummary(r.summary)).toEqual({
      scoreLabel: '5.0',
      scoreStars: '★★★★★',
      count: 1,
      countLabel: '1 条评价',
      dist: [
        { label: '5 星', pct: 100, w: 142 },
        { label: '4 星', pct: 0, w: 0 },
        { label: '3 星', pct: 0, w: 0 },
        { label: '2 星', pct: 0, w: 0 },
      ],
      tags: [{ tag: '手感好', n: 1 }],
    })
  })

  it('详情页评分摘要只有均分和条数，照样出汇总头', () => {
    expect(mapSummary(T('getRatingSummary'))).toMatchObject({ scoreLabel: '5.0', count: 1, countLabel: '1 条评价' })
  })
})

describe('学习链映射（activateCourse / getMyCourses / getCourses / getMyProgress 真实形状）', () => {
  it('激活：新码进恭喜屏、本人已进课的码进欢迎回来屏，都带课程 id', () => {
    expect(activationView(T('activateCourse'))).toEqual({ kind: 'activated', courseId: 'c1' })
    expect(activationView(T('activateCourse:mine'))).toEqual({ kind: 'mine', courseId: 'c1' })
  })

  it('我的课程：标题对上课程目录，进度按段算（3 段学完 1 段）', () => {
    const [c] = mapMyCourses(T('getMyCourses').list, T('getCourses').list, T('getMyProgress').list)
    expect(c).toMatchObject({ courseId: 'c1', title: '小棉鸭入门', doneCount: 1, totalSegments: 3, percent: 33, progressUnknown: false })
    expect(c.enteredAtLabel).not.toBe('')
  })

  it('课程目录：hasVideo 挑续播段，上次看到哪就从哪接着播', () => {
    const { chapters, continueTarget } = mapCatalog(T('getCourses').list[0], T('getMyProgress').list, 'c1')
    expect(chapters).toEqual([
      {
        title: '第一章',
        lessons: [
          { lessonId: 'l1', name: '起针', status: 'todo', firstPlayableSegId: 's1', segs: ['done', 'todo'] },
          { lessonId: 'l2', name: '短针', status: 'current', firstPlayableSegId: 's3', segs: ['current'] },
        ],
      },
    ])
    expect(continueTarget).toEqual({ segmentId: 's3', lessonId: 'l2', lessonName: '短针', resumeAt: 90 })
  })
})

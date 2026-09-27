// 小程序 ↔ app 网关：收银台、商品、评价、学习链读口的响应契约锁（Issue #400），对照 tests/contracts/app-shop-learning.json。
// 小程序映射层测试 rewrite/mp/tests/p-contract-mp-mappers.test.ts 喂的就是这里锁住的 sample：云端改键或改值先在这里红，
// 改契约后小程序那边再红。数据一律经真写侧造（后台 saveDraft/publishProduct、saveCourseDraft/publishCourse、
// 下单→回调→发货→收货→submitReview→setReviewPicked、activateCourse→confirmEnter→trackEvent）；
// 只有激活卡 qrcodes 用 seed：activateCourse 只回 {state,courseId}，卡档的键进不了响应。
// 时间冻结、单号随机数固定：sample 逐值对照，里面有时间戳。
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { control } from 'wx-server-sdk'
import CONTRACT from '../../../tests/contracts/app-shop-learning.json'
import { main as app } from '../src/functions/app/index'
import { main as adminApi } from '../src/functions/adminApi/index'
import { main as payCallback } from '../src/functions/callbacks/payCallback'
import { sha } from '../src/functions/adminApi/lib'

const CASES = CONTRACT.cases as unknown as Record<string, { action: string; sample: unknown }>

const call = (action: string, data: Record<string, unknown> = {}) => app({ action, data }) as Promise<any>
const post = async (action: string, data: Record<string, unknown> = {}) => {
  const r = JSON.parse(
    (await adminApi({
      httpMethod: 'POST',
      headers: { 'x-forwarded-for': '7.7.7.7' },
      body: JSON.stringify({ action, key: 'super-secret-key', data }),
    })).body
  )
  expect(r.ok, `${action} ${JSON.stringify(r)}`).toBe(true)
}
const asMe = async (action: string, data: Record<string, unknown> = {}) => {
  control.setOpenId('oME')
  const r = await call(action, data)
  control.setOpenId('')
  return r
}

const ADDR = { name: '张三', phone: '13800000000', region: '浙江·杭州', detail: 'xx 路 1 号' }
const PRODUCT = {
  id: 'p1', name: '小棉鸭钩织礼盒', tag: '基础款', price: '198', was: '258', sold: 128, brief: '零基础友好',
  cover: 'cloud://env/p1-cover.jpg', images: ['cloud://env/p1-a.jpg'], skus: [{ name: '基础款', price: '198' }],
  params: [['材质', '纯棉']], detailSections: [{ lead: '关于', body: '正文' }], kit: [{ name: '钩针', qty: '1 支' }], courseId: 'c1',
}
// l1 两段（一段已剪一段未剪）、l2 一段：目录页要靠 hasVideo 挑续播段，靠 m:ss 时长算分钟
const COURSE = {
  id: 'c1', title: '小棉鸭入门', sort: 1,
  chapters: [
    {
      id: 'ch1', title: '第一章',
      lessons: [
        { id: 'l1', name: '起针', dur: '8:00', segments: [{ id: 's1', name: '绕线', dur: '5:00', videoFileId: 'cloud://env/s1.mp4' }, { id: 's2', name: '收尾', dur: '3:00', videoFileId: '' }] },
        { id: 'l2', name: '短针', dur: '4:00', segments: [{ id: 's3', name: '短针一圈', dur: '4:00', videoFileId: 'cloud://env/s3.mp4' }] },
      ],
    },
  ],
}
const PAY_ORDER = { id: '' }

async function buy(): Promise<string> {
  const r = await asMe('createOrder', { items: [{ id: 'p1', qty: 1 }], address: ADDR })
  expect(r.ok, JSON.stringify(r)).toBe(true)
  return r.order.id
}

// 各 case 的请求参数与身份（action 名只在契约里写一份）
const REQ: Record<string, { me: boolean; data: () => Record<string, unknown> }> = {
  pay: { me: true, data: () => ({ id: PAY_ORDER.id }) },
  getProducts: { me: false, data: () => ({}) },
  getProductDetail: { me: false, data: () => ({ id: 'p1' }) },
  getReviews: { me: false, data: () => ({ productId: 'p1' }) },
  getRatingSummary: { me: false, data: () => ({ productId: 'p1' }) },
  activateCourse: { me: true, data: () => ({ code: 'CODE2' }) },
  'activateCourse:mine': { me: true, data: () => ({ code: 'CODE1' }) },
  getMyCourses: { me: true, data: () => ({}) },
  getCourses: { me: false, data: () => ({}) },
  getMyProgress: { me: true, data: () => ({}) },
}

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-07-01T04:00:00Z'))
  let seq = 0
  vi.spyOn(Math, 'random').mockImplementation(() => (++seq % 9000) / 9000)
  control.reset()
  control.setOpenId('')
  control.seed('adminConfig', [{ _id: 'auth', keyHash: sha('super-secret-key'), role: 'superadmin' }])
  control.seed('config', [{ _id: 'pay', mode: 'real', flowId: 'flow-pay' }])
  control.seed('users', [{ _id: 'u1', _openid: 'oME', nickname: '鸭鸭' }])
  control.seed('qrcodes', ['CODE1', 'CODE2'].map((c) => ({ _id: c, code: c, courseId: 'c1', status: 'unused', activatedBy: null, activatedAt: null, createdAt: 1 })))

  await post('saveDraft', { product: PRODUCT })
  await post('publishProduct', { id: 'p1' })
  await post('saveStock', { productId: 'p1', spec: '基础款', stock: 5, threshold: 1 })
  await post('saveCourseDraft', { course: COURSE })
  await post('publishCourse', { courseId: 'c1' })

  // 收到货并评价、被挑上墙的一单
  const done = await buy()
  await payCallback({ out_trade_no: done, trade_state: 'SUCCESS', amount: { total: 19800 }, transaction_id: 'wx-1' })
  await post('shipOrder', { id: done, company: '顺丰', trackingNo: 'SF001' })
  expect((await asMe('confirmReceive', { id: done })).ok).toBe(true)
  const rv = await asMe('submitReview', { orderId: done, lineId: 'p1__基础款', rating: 5, text: '好上手', tags: ['手感好'], anon: false })
  expect(rv.ok, JSON.stringify(rv)).toBe(true)
  await post('setReviewPicked', { id: `${done}__p1__基础款`, picked: true })

  // 扫码激活、进课，学完 s1、看到 s3 一半
  expect((await asMe('activateCourse', { code: 'CODE1' })).ok).toBe(true)
  expect((await asMe('confirmEnter', { code: 'CODE1' })).ok).toBe(true)
  await asMe('trackEvent', { type: 'segment_done', targetId: 's1', page: 'player', meta: { courseId: 'c1', lessonId: 'l1', at: 300, dur: 300 } })
  await asMe('trackEvent', { type: 'watch_at', targetId: 's3', page: 'player', meta: { courseId: 'c1', lessonId: 'l2', at: 90, dur: 240 } })

  // 待付款一单，拉收银台时工作流回的是 packageVal（网关要改名成 package）
  PAY_ORDER.id = await buy()
  control.setCallFunctionResult({ result: { data: { timeStamp: '1782878400', nonceStr: 'n0nce', packageVal: 'prepay_id=wx01', signType: 'RSA', paySign: 'sig==' } } })
})
afterAll(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('app 网关收银台/商品/评价/学习链响应契约（tests/contracts/app-shop-learning.json）', () => {
  it('契约自洽：每个 case 都有剧本', () => {
    expect(Object.keys(CASES).sort()).toEqual(Object.keys(REQ).sort())
  })

  for (const [name, c] of Object.entries(CASES)) {
    it(`${name}：整个响应与 sample 全等`, async () => {
      const q = REQ[name]
      const real = q.me ? await asMe(c.action, q.data()) : await call(c.action, q.data())
      expect(real.ok, JSON.stringify(real)).toBe(true)
      expect(real, `${name} 整体`).toEqual(c.sample)
    })
  }
})

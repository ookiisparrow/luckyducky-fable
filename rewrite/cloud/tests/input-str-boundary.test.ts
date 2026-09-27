// 云端入参边界（根因#3 不信前端）：非字符串入参以前经 String() 变成 '[object Object]'/'true' 这类垃圾串，
// 被当成真值查库、写库、改状态；也没有长度上限。现统一走 kit str()：非字符串＝空串（落到各自的缺参分支），超长截断。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { control } from 'wx-server-sdk'
import { COLLECTIONS } from '@ldrw/shared'
import { main as adminApi } from '../src/functions/adminApi/index'
import { main as app } from '../src/functions/app/index'
import { sha } from '../src/functions/adminApi/lib'

const SUPER = 'super-secret-key'
const post = (action: string, data: Record<string, unknown> = {}) =>
  adminApi({
    httpMethod: 'POST',
    headers: { 'x-forwarded-for': '1.1.1.1' },
    body: JSON.stringify({ action, key: SUPER, data }),
  }).then((r: any) => ({ status: r.statusCode, ...JSON.parse(r.body) }))

// 记下每次库操作看到的 id/条件/写入数据，断言垃圾串没混进去
let ops: string[] = []
const GARBAGE = /\[object Object\]|"true"/
const garbageOps = () => ops.filter((s) => GARBAGE.test(s))

beforeEach(() => {
  control.reset()
  control.setOpenId('')
  control.seed(COLLECTIONS.adminConfig, [{ _id: 'auth', keyHash: sha(SUPER), role: 'superadmin' }])
  ops = []
  // 审计日志本就该原样记下请求摘要，不算垃圾落库
  const rec = (p: { coll: string }) => void (p.coll !== COLLECTIONS.auditLog && ops.push(JSON.stringify(p)))
  control.setBeforeGet(rec)
  control.setBeforeCount(rec)
  control.setBeforeUpdate(rec)
  control.setBeforeAdd(rec)
  control.setBeforeRemove(rec)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

const paidOrder = { _id: 'o1', id: 'o1', _openid: 'oBUYER', status: 'paid', amount: 100, goods: 100, transactionId: 'tx-o1', createdAt: 1000, items: [] }

describe('非字符串入参不再被洗成垃圾串落库（bug）', () => {
  // 每条只坏一个字段：几个坏字段放一起时，先被查到的那个会替别的挡掉，另一半就没测到
  const SHIP_CASES: Array<[string, string, Record<string, unknown>]> = [
    ['运单号传 true，以前存成运单号「true」、订单变已发货', 'shipOrder', { id: 'o1', company: 'SF', trackingNo: true }],
    ['运单号传对象', 'shipOrder', { id: 'o1', company: 'SF', trackingNo: {} }],
    ['快递公司传对象', 'shipOrder', { id: 'o1', company: {}, trackingNo: 'T1' }],
    ['订单号传对象，以前拿「[object Object]」去查订单', 'shipOrder', { id: {}, company: 'SF', trackingNo: 'T1' }],
  ]
  it.each(SHIP_CASES)('大白话：发货——%s；现在按缺参拒，订单还是已付款', async (_label, action, data) => {
    control.seed(COLLECTIONS.orders, [paidOrder])
    const r = await post(action, { ...data, ackRefundedQty: null })
    expect(r).toMatchObject({ status: 400, error: 'BAD_ARGS' })
    const o = control.dump(COLLECTIONS.orders).find((x: any) => x._id === 'o1')
    expect(o.status).toBe('paid')
    expect(o.shipping).toBeUndefined()
    expect(garbageOps()).toEqual([])
  })

  it('大白话：批量发货——统一快递公司传对象、某行运单号传 true、某行订单号传对象，都按行拒，订单还是已付款', async () => {
    control.seed(COLLECTIONS.orders, [paidOrder])
    const badCompany = await post('shipOrders', { company: {}, items: [{ id: 'o1', trackingNo: 'T1' }] })
    expect(badCompany.results[0]).toMatchObject({ id: 'o1', ok: false, error: 'BAD_ARGS' })
    const badTracking = await post('shipOrders', { company: 'SF', items: [{ id: 'o1', trackingNo: true }] })
    expect(badTracking.results[0]).toMatchObject({ id: 'o1', ok: false, error: 'BAD_ARGS' })
    const badId = await post('shipOrders', { company: 'SF', items: [{ id: {}, trackingNo: 'T1' }] })
    expect(badId.results[0]).toMatchObject({ ok: false, error: 'BAD_ARGS' })
    const o = control.dump(COLLECTIONS.orders).find((x: any) => x._id === 'o1')
    expect(o.status).toBe('paid')
    expect(o.shipping).toBeUndefined()
    expect(garbageOps()).toEqual([])
  })

  it('大白话：建包装物料时商品号传成对象，以前会建出一条料号「pkg:[object Object]」的物料；现在按缺商品号拒', async () => {
    const r = await post('saveMaterial', { name: '包装', category: 'packaging', uom: 'count', productId: {} })
    expect(r).toMatchObject({ status: 400, error: 'NO_PRODUCT' })
    expect(control.dump(COLLECTIONS.materials)).toEqual([])
  })

  it('大白话：库存调整的防重号传成对象，以前照样记账、防重号记成「[object Object]」（之后别的垃圾提交会被误当重放吞掉）；现在按缺参拒', async () => {
    await post('saveMaterial', { name: '纽扣', category: 'accessory', uom: 'count', slug: 'button' })
    ops = []
    const r = await post('adjustStock', { materialId: 'button', adjustId: {}, delta: 3, reason: '期初' })
    expect(r).toMatchObject({ status: 400, error: 'BAD_ADJUST' })
    expect(garbageOps()).toEqual([])
  })

  it('大白话：支付证书序列号传成对象、商户私钥传成 true，以前照样存成「[object Object]」「true」（支付直接用不了）；现在当没填，一个字段都没有就拒', async () => {
    const r = await post('saveSecureConfig', { docId: 'wxpay', fields: { mchSerial: {}, mchPrivateKey: true } })
    expect(r).toMatchObject({ status: 400, error: 'NO_FIELDS' })
    expect(control.dump(COLLECTIONS.secureConfig)).toEqual([])
  })

  it('大白话：支付配置带前导空白的正常值照旧 trim 后整串存，不会先被截短再存（守等价：不是 bug 用例）', async () => {
    const serial = 'A'.repeat(80)
    const r = await post('saveSecureConfig', { docId: 'wxpay', fields: { mchSerial: ' '.repeat(10) + serial } })
    expect(r.ok).toBe(true)
    expect(control.dump(COLLECTIONS.secureConfig)[0].mchSerial).toBe(serial)
    const tooLong = await post('saveSecureConfig', { docId: 'wxpay', fields: { mchSerial: ' '.repeat(10) + serial + 'B' } })
    expect(tooLong).toMatchObject({ status: 400, error: 'TOO_LONG:mchSerial' })
  })

  it('大白话：外包口令很长也照旧能建、能登（建号端不截，免得跟登录端对不上）', async () => {
    const key = 'k'.repeat(1500)
    expect((await post('createAgent', { name: '长口令', key })).ok).toBe(true)
    const login = await adminApi({
      httpMethod: 'POST',
      headers: { 'x-forwarded-for': '2.2.2.2' },
      body: JSON.stringify({ action: 'login', key, data: {} }),
    })
    expect(login.statusCode).toBe(200)
  })

  it('大白话：产品差异位的商品号/专属料号传成对象，以前会建出一条 _id「[object Object]」的差异位；现在按缺参拒', async () => {
    const colors = { L: 'pink', M: 'blue', S: 'green' }
    const badProduct = await post('saveBomProfile', { profile: { productId: {}, yarnColors: colors, packagingMaterialId: 'x', cardMaterialId: 'x' } })
    expect(badProduct).toMatchObject({ status: 400, error: 'NO_PRODUCT' })
    const badPkg = await post('saveBomProfile', { profile: { productId: 'p1', yarnColors: colors, packagingMaterialId: {}, cardMaterialId: 'x' } })
    expect(badPkg).toMatchObject({ status: 400, error: 'NO_SPECIFIC' })
    expect(control.dump(COLLECTIONS.bomProfiles)).toEqual([])
  })

  it('大白话：商品/课程草稿的 id 传成对象，以前会存出一份 id「[object Object]」的草稿；现在按草稿不合格拒', async () => {
    expect(await post('saveDraft', { product: { id: {}, name: '小鸭' } })).toMatchObject({ status: 400, error: 'BAD_PRODUCT' })
    expect(await post('saveCourseDraft', { course: { id: {}, title: '课' }, baseRev: 0 })).toMatchObject({ status: 400, error: 'BAD_COURSE' })
    expect(control.dump(COLLECTIONS.productsDraft)).toEqual([])
    expect(control.dump(COLLECTIONS.coursesDraft)).toEqual([])
  })

  it('大白话：测版「当新客」的原因传成对象，以前照样刷掉会话进度、原因记成「[object Object]」；外部联系人 id 数组里混进对象也会拿去刷', async () => {
    process.env.CS_TRIAL_REFRESH = '1'
    try {
      const noReason = await post('refreshTrialSession', { externalUserId: 'eu1', reason: {} })
      expect(noReason).toMatchObject({ status: 400, error: 'REASON_REQUIRED' })
      const badIds = await post('refreshTrialSession', { externalUserIds: [{}], reason: '复测' })
      expect(badIds).toMatchObject({ status: 400, error: 'BAD_ARGS' })
      expect(garbageOps()).toEqual([])
      expect(control.dump(COLLECTIONS.kfState)).toEqual([])
    } finally {
      delete process.env.CS_TRIAL_REFRESH
    }
  })

  it('大白话：写库的文字字段有长度上限——供应商号传一大串，以前原样整串写进物料档', async () => {
    const r = await post('saveMaterial', { name: '纽扣', category: 'accessory', uom: 'count', slug: 'button', supplierId: 's'.repeat(5000) })
    expect(r.ok).toBe(true)
    expect(control.dump(COLLECTIONS.materials)[0].supplierId.length).toBe(200)
  })
})

describe('垃圾 id 在查库前就按缺参拒，不再拿「[object Object]」去查（bug）', () => {
  const CASES: Array<[string, Record<string, unknown>, number, string]> = [
    ['getOrderDetail', { id: {} }, 400, 'BAD_ARGS'],
    ['clearFeeMismatch', { id: {} }, 400, 'BAD_ARGS'],
    ['recordPaidFee', { id: {}, paidFeeFen: 100 }, 400, 'BAD_ARGS'],
    ['getRefundDetail', { id: {} }, 400, 'BAD_ARGS'],
    ['approveRefund', { id: {} }, 400, 'BAD_ARGS'],
    ['rejectRefund', { id: {}, reason: '不符' }, 400, 'BAD_ARGS'],
    ['overrideRefund', { orderId: {}, lineId: 'p1__', reason: '人工' }, 400, 'BAD_ARGS'],
    ['resolveAnomaly', { id: {} }, 400, 'BAD_ARGS'],
    ['getCustomer360', { openid: {} }, 400, 'BAD_ARGS'],
    ['getUser', { openid: {} }, 400, 'BAD_ARGS'],
    ['setReviewPicked', { id: {}, picked: true }, 400, 'NO_ID'],
    ['publishProduct', { id: {} }, 400, 'NO_ID'],
    ['unpublishProduct', { id: {} }, 400, 'NO_ID'],
    ['getCourseDraft', { courseId: {} }, 400, 'NO_COURSE_ID'],
    ['getCard', { productId: {} }, 400, 'NO_PRODUCT'],
    ['saveStock', { productId: {}, stock: 1 }, 400, 'NO_PRODUCT'],
    ['listBatchCodes', { batchId: {} }, 400, 'NO_BATCH'],
    ['savePurchase', { supplierId: {} }, 400, 'BAD_SUPPLIER'],
    ['markOrdered', { purchaseId: {} }, 400, 'BAD_ID'],
    ['issueOutwork', { outworkId: {} }, 404, 'NO_OUTWORK'],
    ['saveOutwork', { workerId: {}, pieceRateFen: 0 }, 404, 'NO_WORKER'],
    ['runAssembly', { assemblyId: {}, productId: 'p1' }, 400, 'BAD_ARGS'],
    ['disableAgent', { id: {} }, 400, 'BAD_ID'],
  ]
  it.each(CASES)('%s', async (action, data, status, error) => {
    const r = await post(action, data)
    expect({ status: r.status, error: r.error }).toEqual({ status, error })
    expect(garbageOps()).toEqual([])
  })

  it('小程序商品详情：id 传成对象按缺参拒，不拿去查商品档', async () => {
    const r: any = await app({ action: 'getProductDetail', data: { id: {} } })
    expect(r).toMatchObject({ ok: false, error: 'BAD_ARGS' })
    expect(garbageOps()).toEqual([])
  })

  const ADMIN_READS: Array<[string, Record<string, unknown>, number, string]> = [
    ['saveQcMark', { sessionKey: {}, score: 5 }, 400, 'BAD_ARGS'],
    ['getRestockPlan', { targets: [{ productId: {}, sets: 1 }] }, 400, 'BAD_TARGETS'],
  ]
  it.each(ADMIN_READS)('%s', async (action, data, status, error) => {
    const r = await post(action, data)
    expect({ status: r.status, error: r.error }).toEqual({ status, error })
    expect(garbageOps()).toEqual([])
  })

  it('筛选/查找条件里传对象：当没传，不拿「[object Object]」当条件去查', async () => {
    for (const [action, data] of [
      ['listAnomalies', { kind: {} }],
      ['listAudit', { operator: {}, actionPrefix: {} }],
      ['searchConversations', { openid: {}, externalUserId: true, channel: {}, keyword: {} }],
      ['conversationsReport', { channel: {} }],
      ['saveShowcase', { items: [{ id: {}, sort: 1 }] }],
    ] as const) {
      const r = await post(action, data)
      expect(r.status).toBe(200)
    }
    expect(garbageOps()).toEqual([])
  })
})

describe('小程序入参：对象/true 不再被洗成垃圾串查库写库（bug）', () => {
  const call = (action: string, data: Record<string, unknown>) => app({ action, data }) as Promise<any>
  const refundable = { ...paidOrder, items: [{ productId: 'p1', lineId: 'p1__基础款', name: '小鸭', price: 100, qty: 1, refundable: true }] }

  beforeEach(() => control.setOpenId('oBUYER'))

  it('大白话：申请退款的原因传成对象，以前售后单的原因存成「[object Object]」；现在当没填', async () => {
    control.seed(COLLECTIONS.orders, [refundable])
    const r = await call('applyRefund', { orderId: 'o1', lineId: 'p1__基础款', reason: { a: 1 } })
    expect(r.ok).toBe(true)
    expect(control.dump(COLLECTIONS.afterSales)[0].reason).toBe('')
    expect(garbageOps()).toEqual([])
  })

  it('大白话：下单地址的收件人传成对象，以前订单地址存成「[object Object]」；现在按地址不全拒；数字手机号照旧收', async () => {
    process.env.ALLOW_MOCK_PAY = '1'
    try {
      control.seed(COLLECTIONS.products, [{ _id: 'p1', id: 'p1', name: '小鸭礼盒', price: 198 }])
      const addr = { name: '张三', phone: 13800000000, region: '浙江·杭州', detail: 'xx 路 1 号' }
      const bad = await call('createOrder', { items: [{ id: 'p1', qty: 1 }], address: { ...addr, name: {} } })
      expect(bad).toMatchObject({ ok: false, error: 'BAD_ADDRESS' })
      expect(control.dump(COLLECTIONS.orders)).toEqual([])
      const good = await call('createOrder', { items: [{ id: 'p1', qty: 1 }], address: addr })
      expect(good.ok).toBe(true)
      expect(good.order.address.phone).toBe('13800000000')
    } finally {
      delete process.env.ALLOW_MOCK_PAY
    }
  })

  const CASES: Array<[string, Record<string, unknown>, string]> = [
    ['pay', { id: {} }, 'NO_ID'],
    ['confirmReceive', { id: {} }, 'NO_ID'],
    ['cancelOrder', { id: {} }, 'NO_ID'],
    ['getOrderById', { id: {} }, 'NO_ID'],
    ['applyRefund', { orderId: {}, lineId: 'p1__基础款' }, 'BAD_ARGS'],
    ['applyRefund', { orderId: 'o1', lineId: {} }, 'BAD_ARGS'],
    ['submitReview', { orderId: {}, lineId: 'p1__基础款', rating: 5 }, 'BAD_ARGS'],
    ['getReviews', { productId: {} }, 'NO_PRODUCT'],
    ['getRatingSummary', { productId: {} }, 'NO_PRODUCT'],
    ['activateCourse', { code: {} }, 'INVALID_CODE'],
    ['confirmEnter', { code: {} }, 'BAD_ARGS'],
    ['getPlaybackUrl', { courseId: {}, segmentId: 's1' }, 'BAD_ARGS'],
  ]
  it.each(CASES)('%s %j', async (action, data, error) => {
    control.seed(COLLECTIONS.orders, [refundable])
    const r = await call(action, data)
    expect(r).toMatchObject({ ok: false, error })
    expect(garbageOps()).toEqual([])
  })

  it('订单状态筛选/课程 id 列表里传对象：当没传，不拿去查', async () => {
    expect((await call('getMyOrders', { status: {} })).ok).toBe(true)
    await call('getCourses', { ids: [{}, true] })
    expect(garbageOps()).toEqual([])
  })
})

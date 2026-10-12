// 后台 ↔ adminApi 钱相关响应契约锁（Issue #388）：跑真 adminApi，对照 tests/contracts/admin-money.json。
// 同一套剧本也锁小程序 ↔ app 网关的订单/售后读口（tests/contracts/app-orders.json，见文件末尾）。
// 订单/售后/库存行在响应里是整档透传（{...doc}），键集由写侧决定，所以剧本一律经真写侧造数
// （createOrder → payCallback → shipOrder / applyRefund → approveRefund → refundCallback / saveStock）；
// 自造 seed 只锁得住自己的回声。wxBills/courses/progress 仍用 seed：它们在响应里被逐字段重建，seed 的键进不了响应。
// 整体全等而不只比键集和金额：后台映射读的是状态/标志/计数（status、feeMismatch、refundHold、counts.*…），
// 只锁金额的话云端改了这些值，两边测试都绿、线上后台却映射错。真单号尾 4 位与 sample 不同，比之前换成 sample 的固定号。
// 时间冻结：sample 逐值对照，对账还按北京日期分桶，墙钟一滑就会跨日。
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { control } from 'wx-server-sdk'
import CONTRACT from '../../../tests/contracts/admin-money.json'
import APP_CONTRACT from '../../../tests/contracts/app-orders.json'
import { main as app } from '../src/functions/app/index'
import { main as adminApi } from '../src/functions/adminApi/index'
import { main as payCallback } from '../src/functions/callbacks/payCallback'
import { main as refundCallback } from '../src/functions/callbacks/refundCallback'
import { sha } from '../src/functions/adminApi/lib'

interface Case {
  action: string
  keys: Record<string, string[]>
  units: Record<string, string>
  sample: unknown
}
const CASES = CONTRACT.cases as unknown as Record<string, Case>

const call = (action: string, data: Record<string, unknown> = {}) => app({ action, data }) as Promise<any>
const post = (action: string, data: Record<string, unknown> = {}) =>
  adminApi({
    httpMethod: 'POST',
    headers: { 'x-forwarded-for': '6.6.6.6' },
    body: JSON.stringify({ action, key: 'super-secret-key', data }),
  }).then((r: any) => JSON.parse(r.body))
const keysOf = (o: any) => Object.keys(o).sort()
// 路径写法见契约文件 $comment：x[] 取数组首元素，* 取对象首个值
const at = (o: any, path: string): any =>
  path
    .split('.')
    .filter(Boolean)
    .reduce((v, seg) => {
      const arr = seg.endsWith('[]')
      const k = arr ? seg.slice(0, -2) : seg
      const x = k === '*' ? Object.values(v)[0] : v[k]
      return arr ? x[0] : x
    }, o)

const DAY = '2026-07-01'
const ADDR = { name: '张三', phone: '13800000000', region: '浙江·杭州', detail: 'xx 路 1 号' }
const W = { A: '', B: '', C: '', D: '', asD: '' }
// sample 里的固定单号；真单号尾 4 位落在 1000–9999，与 0001–0004 不会互相串
const FIXED = { A: '2026070112000001', B: '2026070112000002', C: '2026070112000003', D: '2026070112000004' }
const normalize = (o: unknown) =>
  JSON.parse((['A', 'B', 'C', 'D'] as const).reduce((s, k) => s.split(W[k]).join(FIXED[k]), JSON.stringify(o)))

async function buy(): Promise<string> {
  control.setOpenId('oME')
  const r = await call('createOrder', { items: [{ id: 'p1', qty: 1 }], address: ADDR })
  control.setOpenId('')
  expect(r.ok).toBe(true)
  // 取号若不再走 Math.random，beforeAll 的序列就失效；撞号当场报，而不是在后面某步给一个对不上号的失败
  expect(Object.values(W), `单号撞了：${r.order.id}`).not.toContain(r.order.id)
  return r.order.id
}
const pay = (id: string, totalFen: number, txn: string) =>
  payCallback({ out_trade_no: id, trade_state: 'SUCCESS', amount: { total: totalFen }, transaction_id: txn })
async function applyRefund(orderId: string): Promise<string> {
  const o = control.dump('orders').find((x: any) => x._id === orderId)
  control.setOpenId('oME')
  const r = await call('applyRefund', { orderId, lineId: o.items[0].lineId, reason: '尺寸不合适' })
  control.setOpenId('')
  expect(r.ok).toBe(true)
  return control.dump('afterSales').find((a: any) => a.orderId === orderId)._id
}

// 各 case 的请求参数（action 名只在契约里写一份）
const REQ: Record<string, () => Record<string, unknown>> = {
  listOrders: () => ({ q: W.A }),
  'listOrders:payment_exception': () => ({ q: W.C }),
  orderCounts: () => ({}),
  getOrderDetail: () => ({ id: W.A }),
  listRefunds: () => ({ q: W.D }),
  'listRefunds:refunded': () => ({ q: W.B }),
  refundCounts: () => ({}),
  getRefundDetail: () => ({ id: W.asD }),
  getReconciliation: () => ({ from: DAY, to: DAY }),
  getBillMatch: () => ({ from: DAY, to: DAY }),
  getDashboard: () => ({}),
  listInventory: () => ({ productIds: ['p1'] }),
}

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(DAY + 'T04:00:00Z'))
  // 4 单同 openid 同一冻结分钟，单号只剩随机尾 4 位可区分；撞号会多走一轮换号，逐次递增的序列让单号一次取成、可复现。
  let seq = 0
  vi.spyOn(Math, 'random').mockImplementation(() => (++seq % 9000) / 9000)
  control.reset()
  control.setOpenId('')
  control.seed('products', [{ _id: 'p1', id: 'p1', name: '小鸭礼盒', price: 198, tag: '', courseId: 'course-p1' }])
  control.seed('config', [{ _id: 'pay', mode: 'real', flowId: 'flow-pay', refundFlowId: 'flow-refund' }])
  control.seed('adminConfig', [{ _id: 'auth', keyHash: sha('super-secret-key'), role: 'superadmin' }])
  expect((await post('saveStock', { productId: 'p1', spec: '', stock: 5, threshold: 2 })).ok).toBe(true)

  W.A = await buy() // 已发货
  await pay(W.A, 19800, 'wx-A')
  expect((await post('shipOrder', { id: W.A, company: '顺丰', trackingNo: 'SF001', ackRefundedQty: {} })).ok).toBe(true)

  W.B = await buy() // 已全额退款
  await pay(W.B, 19800, 'wx-B')
  const asB = await applyRefund(W.B)
  control.setCallFunctionResult({ result: { data: { status: 'PROCESSING', refund_id: 'r1' } } })
  expect((await post('approveRefund', { id: asB })).ok).toBe(true)
  const outRefundNo = control.dump('afterSales').find((a: any) => a._id === asB).outRefundNo
  await refundCallback({ out_refund_no: outRefundNo, out_trade_no: W.B, refund_status: 'SUCCESS', transaction_id: 'wx-rf', amount: { refund: 19800 } })

  W.C = await buy() // 少付 100 元 → 支付异常
  await pay(W.C, 10000, 'wx-C')

  W.D = await buy() // 已付，售后待审核
  await pay(W.D, 19800, 'wx-D')
  W.asD = await applyRefund(W.D)

  const bill = (txn: string, outTradeNo: string, orderAmount: number) => ({
    _id: `${DAY}:${txn}`, date: DAY, transactionId: txn, outTradeNo, orderAmount, refundAmount: 0, tradeState: 'SUCCESS', tradeTime: DAY + ' 12:00:00',
  })
  control.seed('wxBills', [bill('wx-A', W.A, 198), bill('wx-B', W.B, 190), bill('wx-ghost', 'ghost', 5.5)])
  control.seed('courses', [{ _id: 'course-p1', id: 'course-p1', title: '小鸭', chapters: [{ lessons: [{ name: '第一课', segments: [{ id: 's1', name: '起针' }] }] }] }])
  control.seed('progress', [{ _id: 'oME:course-p1', done: { s1: true }, last: { segmentId: 's1' } }])
})
afterAll(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('adminApi 钱相关响应契约（tests/contracts/admin-money.json）', () => {
  it('契约自洽：每个 case 都有剧本；sample 的键集合就是 keys；units 字段在 sample 里是数字', () => {
    expect(Object.keys(CASES).sort()).toEqual(Object.keys(REQ).sort())
    for (const [name, c] of Object.entries(CASES)) {
      for (const [p, keys] of Object.entries(c.keys)) expect(keysOf(at(c.sample, p)), `${name} ${p || '顶层'}`).toEqual(keys)
      for (const p of Object.keys(c.units)) expect(typeof at(c.sample, p), `${name} ${p}`).toBe('number')
    }
  })

  for (const [name, c] of Object.entries(CASES)) {
    it(`${name}：键集合、金额单位与契约一致，整个响应（单号归一后）与 sample 全等`, async () => {
      const real = await post(c.action, REQ[name]())
      expect(real.ok, JSON.stringify(real)).toBe(true)
      for (const [p, keys] of Object.entries(c.keys)) expect(keysOf(at(real, p)), `${name} ${p || '顶层'}`).toEqual(keys)
      for (const [p, unit] of Object.entries(c.units)) expect(at(real, p), `${name} ${p}（${unit}）`).toBe(at(c.sample, p))
      expect(normalize(real), `${name} 整体`).toEqual(c.sample)
    })
  }
})

// 小程序那一侧：app 网关的订单/售后读口，同一套剧本（买家都是 oME）。小程序映射层测试 rewrite/mp/tests/p-contract-mp-mappers.test.ts
// 喂的就是这里锁住的 sample——云端改键/改值先在这里红，改契约后小程序那边再红。
const APP_CASES = APP_CONTRACT.cases as unknown as Record<string, { action: string; sample: unknown }>
const APP_REQ: Record<string, () => Record<string, unknown>> = {
  getMyOrders: () => ({ limit: 20 }),
  getOrderById: () => ({ id: W.A }),
  getMyAfterSales: () => ({ limit: 20 }),
}

describe('app 网关订单/售后响应契约（tests/contracts/app-orders.json）', () => {
  it('契约自洽：每个 case 都有剧本', () => {
    expect(Object.keys(APP_CASES).sort()).toEqual(Object.keys(APP_REQ).sort())
  })

  for (const [name, c] of Object.entries(APP_CASES)) {
    it(`${name}：整个响应（单号归一后）与 sample 全等`, async () => {
      control.setOpenId('oME')
      const real = await call(c.action, APP_REQ[name]())
      control.setOpenId('')
      expect(real.ok, JSON.stringify(real)).toBe(true)
      expect(normalize(real), `${name} 整体`).toEqual(c.sample)
    })
  }
})

// E2E·退款全链钱守恒（跨函数：applyRefund/overrideRefund/approveRefund/refundCallback）：钉「无论谁发起、
// 重复发起、并发撞键，一行退款额永不越过该行分摊上限、全单累计永不越过实付、绝不二次打款」的跨函数钱红线。
import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as app } from '../src/functions/app/index'
import { main as adminApi } from '../src/functions/adminApi/index'
import { main as refundCallback } from '../src/functions/callbacks/refundCallback'
import { sha } from '../src/functions/adminApi/lib'

const call = (action: string, data: Record<string, unknown> = {}) => app({ action, data }) as Promise<any>
const cb = (e: Record<string, unknown>) => refundCallback(e) as Promise<any>
const post = (action: string, data: Record<string, unknown> = {}) =>
  adminApi({
    httpMethod: 'POST',
    headers: { 'x-forwarded-for': '8.8.8.8' },
    body: JSON.stringify({ action, key: 'super-secret-key', data }),
  }).then((r: any) => ({ status: r.statusCode, ...JSON.parse(r.body) }))

const seedFlow = () => control.seed('config', [{ _id: 'pay', mode: 'real', refundFlowId: 'flow-refund' }])
const seedAdmin = () => control.seed('adminConfig', [{ _id: 'auth', keyHash: sha('super-secret-key'), role: 'superadmin' }])

// 两行对称订单：amount=goods=100（无券），A/B 各价 50、各理论分摊 50。
const seedTwoLine = (over: Record<string, unknown> = {}) =>
  control.seed('orders', [
    {
      _id: 'o1', id: 'o1', _openid: 'oBUYER', status: 'paid', amount: 100, goods: 100, createdAt: 1000,
      address: { name: '张三', phone: '138', region: 'x', detail: 'y' },
      items: [
        { productId: 'pA', lineId: 'pA__x', spec: 'x', name: 'A', price: 50, qty: 1, refundable: true },
        { productId: 'pB', lineId: 'pB__x', spec: 'x', name: 'B', price: 50, qty: 1, refundable: true },
      ],
      ...over,
    },
  ])

beforeEach(() => {
  control.reset()
  control.setOpenId('')
  seedAdmin()
})

describe('退款全链钱守恒（E2E·跨函数钱红线）', () => {
  it('大白话：同一行连续越规退款——即便兄弟行仍有余额，本行也被行级封顶挡住，累计退款≤行分摊且≤全单实付', async () => {
    seedTwoLine()
    seedFlow()
    control.setCallFunctionResult({ result: { data: { status: 'PROCESSING', refund_id: 'r1' } } })

    // A 行第一次越规：吃满该行 50 元分摊
    const first = await post('overrideRefund', { orderId: 'o1', lineId: 'pA__x', reason: '越规1' })
    expect(first.ok).toBe(true)
    // A 行第二次：兄弟行 B 还有 50 元余量，但 A 行自己已满→行级封顶 NOTHING_LEFT（不能吃 B 的钱）
    const second = await post('overrideRefund', { orderId: 'o1', lineId: 'pA__x', reason: '越规2' })
    expect(second.error).toBe('NOTHING_LEFT')

    // 钱守恒断言：A 行累计已退 ≤ 该行分摊 50；全单累计已退 ≤ 实付 100
    const settled = control.dump('afterSales').filter((a: any) => ['applied', 'approved', 'refunded'].includes(a.status))
    const lineA = settled.filter((a: any) => (a.lineId || a.productId) === 'pA__x').reduce((s: number, a: any) => s + a.refundAmount, 0)
    const orderTotal = settled.reduce((s: number, a: any) => s + a.refundAmount, 0)
    expect(lineA).toBeLessThanOrEqual(50)
    expect(orderTotal).toBeLessThanOrEqual(100)
    // 只触发了一笔真打款（第二次在 NOTHING_LEFT 前中止·绝不第二次打款）
    expect(control.callFunctionCalls().length).toBe(1)
  })

  it('大白话：审批打款后退款回调 SUCCESS 落地→refunded；再次审批被 BAD_STATUS 拒，绝不二次打款', async () => {
    control.seed('orders', [
      { _id: 'o1', id: 'o1', _openid: 'oBUYER', status: 'paid', amount: 178, goods: 198, createdAt: 1000,
        items: [{ productId: 'p1', lineId: 'p1__红', spec: '红', name: '鸭', price: 198, qty: 1, refundable: true }] },
    ])
    control.seed('afterSales', [
      { _id: 'as1', orderId: 'o1', _openid: 'oBUYER', lineId: 'p1__红', productId: 'p1', spec: '红', qty: 1, refundAmount: 178, status: 'applied', appliedAt: 2000 },
    ])
    seedFlow()
    control.setCallFunctionResult({ result: { data: { status: 'PROCESSING', refund_id: 'r1' } } })

    // 审批：applied→approved 并触发退款工作流（一次打款）
    const ap = await post('approveRefund', { id: 'as1' })
    expect(ap.ok).toBe(true)
    expect(control.dump('afterSales')[0].status).toBe('approved')
    expect(control.callFunctionCalls().length).toBe(1)
    const outRefundNo = control.dump('afterSales')[0].outRefundNo

    // 退款回调 SUCCESS（真回调无用户身份）：approved→refunded，留退款交易号
    await cb({ out_refund_no: outRefundNo, out_trade_no: 'o1', refund_status: 'SUCCESS', transaction_id: 'wx-rf', amount: { refund: 17800 } })
    const as1 = control.dump('afterSales')[0]
    expect(as1.status).toBe('refunded')
    expect(as1.refundTransactionId).toBe('wx-rf')

    // 再次审批：已 refunded 非 applied → BAD_STATUS，绝不第二次打款
    const again = await post('approveRefund', { id: 'as1' })
    expect(again.error).toContain('BAD_STATUS')
    expect(control.callFunctionCalls().length).toBe(1) // 仍只一次打款
  })

  it('大白话：applyRefund 与 overrideRefund 撞同一 orderId__lineId——恰一条落库，输家判 CONCURRENT/ALREADY_APPLIED，不重复退款', async () => {
    // ① 客户先申请（落库 o1__pA__x），管理端越规再撞同一裸位：TOCTOU 窗口用 beforeAdd 复现「读时空、写时撞」
    seedTwoLine()
    seedFlow()
    control.setCallFunctionResult({ result: { data: { status: 'PROCESSING' } } })
    control.setBeforeAdd(async ({ coll, data }: any) => {
      if (coll === 'afterSales' && data && data._id === 'o1__pA__x') {
        // overrideRefund 读 exist 为空、算得基础位 asId=o1__pA__x，真 add() 前一刻客户 applyRefund 抢先落库
        control.seed('afterSales', [
          { _id: 'o1__pA__x', orderId: 'o1', _openid: 'oBUYER', lineId: 'pA__x', productId: 'pA', qty: 1, refundAmount: 50, status: 'applied', appliedAt: 2000 },
        ])
      }
    })
    const r = await post('overrideRefund', { orderId: 'o1', lineId: 'pA__x', reason: '越规撞键' })
    control.setBeforeAdd(null as never)
    expect(r.status).toBe(409)
    expect(r.error).toBe('CONCURRENT') // 越规输家：撞客户那笔·不另写一份
    expect(control.dump('afterSales').filter((a: any) => (a.lineId || a.productId) === 'pA__x').length).toBe(1) // 恰一条落库
    expect(control.callFunctionCalls().length).toBe(0) // 绝不接着触发第二笔真退款

    // ② 反向：售后单已存在时客户 applyRefund 撞同一行 → ALREADY_APPLIED（本人视角走 app.applyRefund）
    control.reset(); control.setOpenId('oBUYER'); seedAdmin()
    seedTwoLine(); seedFlow()
    control.seed('afterSales', [
      { _id: 'o1__pA__x', orderId: 'o1', _openid: 'oBUYER', lineId: 'pA__x', productId: 'pA', qty: 1, refundAmount: 50, status: 'applied', appliedAt: 2000 },
    ])
    const dup = await call('applyRefund', { orderId: 'o1', lineId: 'pA__x' })
    expect(dup.error).toBe('ALREADY_APPLIED')
    expect(control.dump('afterSales').filter((a: any) => (a.lineId || a.productId) === 'pA__x').length).toBe(1) // 仍恰一条
  })
})

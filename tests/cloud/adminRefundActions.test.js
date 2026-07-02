import { describe, it, expect, beforeEach } from 'vitest'
import { createHash } from 'node:crypto'
import cloud, { control } from 'wx-server-sdk'
import { main } from '../../packages/cloud/src/functions/admin/adminApi'

// adminApi 钱相关动作首批测试（审核批次A）：approveRefund 原子抢占 + 失败回滚、
// rejectRefund 必填原因、clearFeeMismatch、shipOrder 金额异常拦截。
const KEY = 'test-admin-key-123'
const sha = (s) => createHash('sha256').update(String(s)).digest('hex')

// 模拟控制台 HTTP 调用：POST + 口令 + action 分发，返回解析后的 body
async function call(action, data = {}, key = KEY) {
  const res = await main({ httpMethod: 'POST', body: JSON.stringify({ action, key, data }) })
  return { status: res.statusCode, ...JSON.parse(res.body) }
}

const WORKFLOW_OK = { result: { data: { status: 'PROCESSING' } } }

beforeEach(() => {
  control.reset()
  control.seed('adminConfig', [{ _id: 'auth', keyHash: sha(KEY) }])
  control.seed('config', [{ _id: 'pay', mode: 'real', refundFlowId: 'refund-flow-test' }])
  control.seed('orders', [
    { _id: 'o1', id: 'o1', status: 'paid', amount: 178, address: {}, items: [] },
    { _id: 'o2', id: 'o2', status: 'paid', amount: 50, feeMismatch: true, address: {}, items: [] },
  ])
  control.seed('afterSales', [
    { _id: 'o1__p1', orderId: 'o1', productId: 'p1', status: 'applied', refundAmount: 178, reason: '测试' },
  ])
  control.setCallFunctionResult(WORKFLOW_OK)
})

describe('adminApi 售后退款动作', () => {
  it('口令错误：401，不进任何业务分支', async () => {
    const res = await call('approveRefund', { id: 'o1__p1' }, 'wrong-key')
    expect(res.status).toBe(401)
  })

  it('approveRefund：抢占置 approved + 触发退款工作流（金额取售后单分摊额）', async () => {
    const res = await call('approveRefund', { id: 'o1__p1' })
    expect(res.ok).toBe(true)
    const as = control.dump('afterSales')[0]
    expect(as.status).toBe('approved')
    const calls = control.callFunctionCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0].data.name).toBe('refund-flow-test')
    expect(calls[0].data.data.out_refund_no).toBe('o1__p1')
    expect(calls[0].data.data.amount).toEqual({ refund: 17800, total: 17800, currency: 'CNY' })
  })

  it('进课后撤退货权：同意退款被复核拦（ENTERED_NOT_REFUNDABLE·不触发退款·外审 P1.2）', async () => {
    // 用户先申请退款（applied）后又确认进课 → confirmEnter 把该订单行 refundable 翻 false。
    control.seed('orders', [
      { _id: 'o3', id: 'o3', status: 'paid', amount: 100, address: {}, items: [{ productId: 'p3', price: 100, qty: 1, refundable: false }] },
    ])
    control.seed('afterSales', [{ _id: 'o3__p3', orderId: 'o3', productId: 'p3', status: 'applied', refundAmount: 100, reason: '测试' }])
    const res = await call('approveRefund', { id: 'o3__p3' })
    expect(res.status).toBe(400)
    expect(res.error).toBe('ENTERED_NOT_REFUNDABLE')
    expect(control.dump('afterSales').find((a) => a._id === 'o3__p3').status).toBe('applied') // 未被抢占
    expect(control.callFunctionCalls()).toHaveLength(0) // 退款工作流未触发（防"已交付课程+已退款"）
  })

  it('重复审批：第二次请求被状态闸拒绝，不会二次触发退款', async () => {
    await call('approveRefund', { id: 'o1__p1' })
    const res = await call('approveRefund', { id: 'o1__p1' })
    expect(res.status).toBe(400)
    expect(res.error).toBe('BAD_STATUS:approved')
    expect(control.callFunctionCalls()).toHaveLength(1) // 外部退款只触发一次
  })

  it('工作流未受理：回滚 applied 可重试，返回 REFUND_TRIGGER_FAIL', async () => {
    control.setCallFunctionResult({ result: {} })
    const res = await call('approveRefund', { id: 'o1__p1' })
    expect(res.status).toBe(500)
    expect(res.error).toBe('REFUND_TRIGGER_FAIL')
    expect(control.dump('afterSales')[0].status).toBe('applied') // 已回滚
  })

  it('回滚条件化：触发退款期间回调抢先置 refunded → 回滚不打回 applied（防二次退款·审计 P1）', async () => {
    // 模拟并发：callFlow 进行中（cloudbase_module 已提交但响应丢失/超时），退款回调抢先 approved→refunded
    control.setCallFunctionImpl(async () => {
      await cloud
        .database()
        .collection('afterSales')
        .doc('o1__p1')
        .update({ data: { status: 'refunded', refundedAt: 999 } })
    })
    control.setCallFunctionResult({ result: {} }) // data 缺失 → callFlow 返回 null → 走回滚分支
    await call('approveRefund', { id: 'o1__p1' })
    const as = control.dump('afterSales')[0]
    expect(as.status).toBe('refunded') // 关键：条件回滚（where status:approved）未把已 refunded 打回 applied
    expect(as.refundedAt).toBe(999)
  })

  it('rejectRefund：必填原因；成功置 rejected + 原因落库', async () => {
    expect((await call('rejectRefund', { id: 'o1__p1' })).error).toBe('BAD_ARGS')
    const res = await call('rejectRefund', { id: 'o1__p1', reason: '包装已拆' })
    expect(res.ok).toBe(true)
    const as = control.dump('afterSales')[0]
    expect(as.status).toBe('rejected')
    expect(as.rejectReason).toBe('包装已拆')
  })

  // ── 深审修复批（2026-07-02）①②：申请后又进课重算封顶（用户拍板）+ rejectRefund 原子化 ──

  it('申请后又进课（qty≥2 未全进）：同意时按当下重算封顶——件数/金额降级落库并按新额打款（深审①·用户拍板）', async () => {
    // 买 3 件×100 实付 300；申请时进课 1 件（rec qty=2·200）→ 审批前又进 1 件（enteredQty=2）→ 只剩 1 件可退
    control.seed('orders', [
      {
        _id: 'o5',
        id: 'o5',
        status: 'paid',
        amount: 300,
        goods: 300,
        address: {},
        items: [{ productId: 'p5', lineId: 'p5__', spec: '', price: 100, qty: 3, enteredQty: 2, refundable: true }],
      },
    ])
    control.seed('afterSales', [
      { _id: 'o5__p5__', orderId: 'o5', lineId: 'p5__', productId: 'p5', status: 'applied', qty: 2, itemTotal: 200, refundAmount: 200, reason: '测试' },
    ])
    const res = await call('approveRefund', { id: 'o5__p5__' })
    expect(res.ok).toBe(true)
    const as = control.dump('afterSales').find((a) => a._id === 'o5__p5__')
    expect(as.status).toBe('approved')
    expect(as.qty).toBe(1) // 按当下重算封顶：只退剩余 1 件
    expect(as.refundAmount).toBe(100)
    expect(as.requalifiedAt).toBeGreaterThan(0) // 留痕：这单在审批时降过级
    const calls = control.callFunctionCalls()
    expect(calls[0].data.data.amount.refund).toBe(10000) // 打款按重算后的金额（分）
  })

  it('申请后全进课（enteredQty=qty 而 refundable 痕未翻）：同意被拒 ENTERED_NOT_REFUNDABLE（深审①·fail-closed）', async () => {
    control.seed('orders', [
      {
        _id: 'o6',
        id: 'o6',
        status: 'paid',
        amount: 200,
        goods: 200,
        address: {},
        items: [{ productId: 'p6', lineId: 'p6__', spec: '', price: 100, qty: 2, enteredQty: 2, refundable: true }],
      },
    ])
    control.seed('afterSales', [
      { _id: 'o6__p6__', orderId: 'o6', lineId: 'p6__', productId: 'p6', status: 'applied', qty: 2, itemTotal: 200, refundAmount: 200, reason: '测试' },
    ])
    const res = await call('approveRefund', { id: 'o6__p6__' })
    expect(res.status).toBe(400)
    expect(res.error).toBe('ENTERED_NOT_REFUNDABLE')
    expect(control.callFunctionCalls()).toHaveLength(0)
  })

  it('rejectRefund 竞态窗口：读到 applied 后被同意抢先 → 条件更新不把 approved 打回 rejected（深审②·原子化）', async () => {
    let fired = false
    control.setBeforeUpdate(async ({ coll }) => {
      if (coll !== 'afterSales' || fired) return
      fired = true
      // 并发方：同意退款抢先落库（applied → approved·钱已进退款通道）
      await cloud.database().collection('afterSales').doc('o1__p1').update({ data: { status: 'approved', approvedAt: 1 } })
    })
    const res = await call('rejectRefund', { id: 'o1__p1', reason: '竞态测试' })
    control.setBeforeUpdate(null)
    expect(res.status).toBe(400)
    const as = control.dump('afterSales')[0]
    expect(as.status).toBe('approved') // 不被 clobber：钱一旦进退款通道，状态不能倒回「已拒绝」
  })

  it('金额异常单：shipOrder 被拦（FEE_MISMATCH_HOLD），clearFeeMismatch 解除后可发', async () => {
    const blocked = await call('shipOrder', { id: 'o2', company: '顺丰速运', trackingNo: 'SF123' })
    expect(blocked.error).toBe('FEE_MISMATCH_HOLD')

    expect((await call('clearFeeMismatch', { id: 'o2' })).ok).toBe(true)
    expect(control.dump('orders').find((o) => o._id === 'o2').feeMismatch).toBe(false)

    const shipped = await call('shipOrder', { id: 'o2', company: '顺丰速运', trackingNo: 'SF123' })
    expect(shipped.ok).toBe(true)
    expect(control.dump('orders').find((o) => o._id === 'o2').status).toBe('shipped')
  })
})

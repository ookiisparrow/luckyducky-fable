import { describe, it, expect, beforeEach } from 'vitest'
import { createHash } from 'node:crypto'
import { control } from 'wx-server-sdk'
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

  it('rejectRefund：必填原因；成功置 rejected + 原因落库', async () => {
    expect((await call('rejectRefund', { id: 'o1__p1' })).error).toBe('BAD_ARGS')
    const res = await call('rejectRefund', { id: 'o1__p1', reason: '包装已拆' })
    expect(res.ok).toBe(true)
    const as = control.dump('afterSales')[0]
    expect(as.status).toBe('rejected')
    expect(as.rejectReason).toBe('包装已拆')
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

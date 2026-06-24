import { describe, it, expect, beforeEach } from 'vitest'
import { createHash } from 'node:crypto'
import { control } from 'wx-server-sdk'
import { main } from '../../packages/cloud/src/functions/admin/adminApi'

// 退款决策判据（激活码状态数据链·闭 S10「自动判据」洞·根因#8 不伪造徽章→补真数据）：
// getRefundDetail 按 afterSale._openid + 该商品对应课程（products.courseId·回退 course-<productId>），
// 查 activations 算「买家是否已激活/已进课该课程」——给审核员真判据，不再只靠人工勾。
// 本套即守卫 refund-activation-derived 的行为锁（reverseTest：不查 activations / 永远 activated:false → 红）。
const KEY = 'rd-key-123'
const sha = (s) => createHash('sha256').update(String(s)).digest('hex')
async function call(action, data = {}) {
  const res = await main({ httpMethod: 'POST', body: JSON.stringify({ action, key: KEY, data }) })
  return { status: res.statusCode, ...JSON.parse(res.body) }
}

beforeEach(() => {
  control.reset()
  control.seed('adminConfig', [{ _id: 'auth', keyHash: sha(KEY) }])
  // 商品 P1 有课程 c1；P2 无 courseId（验回退 course-P2）
  control.seed('products', [
    { _id: 'P1', id: 'P1', name: '钩织包', courseId: 'c1' },
    { _id: 'P2', id: 'P2', name: '挂毯', courseId: '' },
  ])
  // 退款单：买家 buyerA 退 P1；buyerB 退 P1；buyerC 退 P2
  control.seed('afterSales', [
    { _id: 'o1__P1', orderId: 'o1', _openid: 'buyerA', productId: 'P1', status: 'applied', refundAmount: 100 },
    { _id: 'o2__P1', orderId: 'o2', _openid: 'buyerB', productId: 'P1', status: 'applied', refundAmount: 100 },
    { _id: 'o3__P2', orderId: 'o3', _openid: 'buyerC', productId: 'P2', status: 'applied', refundAmount: 88 },
  ])
  // 激活记录：buyerA 激活 c1 且已进课（enteredAt 有值）；buyerB 激活 c1 未进课（enteredAt null）；buyerC 无
  control.seed('activations', [
    { _id: 'codeA', _openid: 'buyerA', courseId: 'c1', qrcodeId: 'codeA', code: 'codeA', enteredAt: 1700, createdAt: 1000 },
    { _id: 'codeB', _openid: 'buyerB', courseId: 'c1', qrcodeId: 'codeB', code: 'codeB', enteredAt: null, createdAt: 1100 },
  ])
})

describe('getRefundDetail 激活判据（数据链·根因#8）', () => {
  it('买家已激活且已进课 → activated:true, entered:true + 带激活码', async () => {
    const r = await call('getRefundDetail', { id: 'o1__P1' })
    expect(r.ok).toBe(true)
    expect(r.activation.activated).toBe(true)
    expect(r.activation.entered).toBe(true)
    expect(r.activation.code).toBe('codeA')
    expect(r.activation.courseId).toBe('c1')
  })

  it('买家已激活未进课 → activated:true, entered:false', async () => {
    const r = await call('getRefundDetail', { id: 'o2__P1' })
    expect(r.activation.activated).toBe(true)
    expect(r.activation.entered).toBe(false)
  })

  it('买家未激活 → activated:false, entered:false（退货权未失·可退）', async () => {
    const r = await call('getRefundDetail', { id: 'o3__P2' })
    expect(r.ok).toBe(true)
    expect(r.activation.activated).toBe(false)
    expect(r.activation.entered).toBe(false)
  })

  it('商品无 courseId → 回退 course-<productId>（与 genQrcodes/StepBatch 同口径）', async () => {
    const r = await call('getRefundDetail', { id: 'o3__P2' })
    expect(r.activation.courseId).toBe('course-P2')
  })

  it('退款单不存在 → NO_RECORD', async () => {
    const r = await call('getRefundDetail', { id: 'nope' })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('NO_RECORD')
  })
})

import { describe, it, expect, beforeEach } from 'vitest'
import { createHash } from 'node:crypto'
import { control } from 'wx-server-sdk'
import { main } from '../../packages/cloud/src/functions/admin/adminApi'

// 订单详情激活态（VMlhp·复用 lib.activationFor 与退款判据同口径·根因#8 真数据）：
// getOrderDetail 逐商品查买家是否已激活/已进课对应课程。
// 本套即守卫 order-activation-derived 的行为锁（reverseTest：不查 activations → 红）。
const KEY = 'od-key-123'
const sha = (s) => createHash('sha256').update(String(s)).digest('hex')
async function call(action, data = {}) {
  const res = await main({ httpMethod: 'POST', body: JSON.stringify({ action, key: KEY, data }) })
  return { status: res.statusCode, ...JSON.parse(res.body) }
}

beforeEach(() => {
  control.reset()
  control.seed('adminConfig', [{ _id: 'auth', keyHash: sha(KEY) }])
  control.seed('products', [
    { _id: 'P1', id: 'P1', name: '钩织包', courseId: 'c1' },
    { _id: 'P2', id: 'P2', name: '挂毯', courseId: 'c2' },
  ])
  // 订单含两商品 P1/P2；买家 buyerA
  control.seed('orders', [
    {
      _id: 'o1',
      id: 'o1',
      _openid: 'buyerA',
      status: 'shipped',
      amount: 300,
      items: [
        { productId: 'P1', name: '钩织包', qty: 1, refundable: true },
        { productId: 'P2', name: '挂毯', qty: 1, refundable: true },
      ],
    },
  ])
  // buyerA 激活了 c1 且进课；c2 没激活
  control.seed('activations', [
    { _id: 'codeA', _openid: 'buyerA', courseId: 'c1', qrcodeId: 'codeA', enteredAt: 1700, createdAt: 1000 },
  ])
})

describe('getOrderDetail 逐商品激活态（VMlhp·根因#8）', () => {
  it('返回每商品的激活/进课状态：P1 已激活已进课、P2 未激活', async () => {
    const r = await call('getOrderDetail', { id: 'o1' })
    expect(r.ok).toBe(true)
    expect(r.activations.P1.activated).toBe(true)
    expect(r.activations.P1.entered).toBe(true)
    expect(r.activations.P1.code).toBe('codeA')
    expect(r.activations.P2.activated).toBe(false)
    expect(r.activations.P2.entered).toBe(false)
  })

  it('订单不存在 → NO_ORDER', async () => {
    const r = await call('getOrderDetail', { id: 'nope' })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('NO_ORDER')
  })
})

import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main } from '../../packages/cloud/src/functions/orders/getMyAfterSales'

// getMyAfterSales（orders 域）：只读本人售后单，游标分页，按 appliedAt 倒序。
// 接口正册登记此函数原「未见独立测试」，本用例补齐契约锁（本人隔离 + 分页结构）。
beforeEach(() => {
  control.reset()
  control.setOpenId('u1')
  control.seed('afterSales', [
    { _id: 'a1', _openid: 'u1', orderId: 'o1', productId: 'p1', status: 'applied', appliedAt: 100 },
    { _id: 'a2', _openid: 'u1', orderId: 'o2', productId: 'p2', status: 'refunded', appliedAt: 300 },
    { _id: 'a3', _openid: 'other', orderId: 'o3', productId: 'p3', status: 'applied', appliedAt: 200 },
  ])
})

describe('getMyAfterSales', () => {
  it('只返回本人售后单、按 appliedAt 倒序、游标分页结构', async () => {
    const res = await main({})
    expect(res.ok).toBe(true)
    expect(res.list.map((a) => a._id)).toEqual(['a2', 'a1']) // 本人两条倒序；不含他人 a3
    expect(res).toHaveProperty('nextCursor')
    expect(res.hasMore).toBe(false)
  })

  it('NO_OPENID：未登录拒', async () => {
    control.setOpenId('')
    expect((await main({})).error).toBe('NO_OPENID')
  })
})

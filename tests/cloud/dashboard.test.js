import { describe, it, expect, beforeEach } from 'vitest'
import cloud, { control } from 'wx-server-sdk'
import { getDashboard } from '../../packages/cloud/src/functions/admin/adminApi/actions/dashboard'

// 看板容量上限消除（债#18）：计数走 .count() 精确（不再 ≤1000 内存 length 封顶）、钱链异常走定向
// where 精确（不从样本 filter·防老单漏报）、最近单走 orderBy 取真·最新、GMV/热度近样本 + approx 标注。
// 行为测试钉新契约（>1000 真规模正确性仍待压测·根因#8·归债#19）。
const db = cloud.database()
const ctx = () => ({ db, cloud, data: {}, drafts: {} })
const parse = (res) => JSON.parse(res.body)

beforeEach(() => control.reset())

describe('getDashboard 容量上限消除（债#18）', () => {
  it('计数走 count() 精确；GMV/最近单正确；approx 标注 shape 在', async () => {
    control.seed('users', [{ _id: 'u1' }, { _id: 'u2' }, { _id: 'u3' }])
    control.seed('orders', [
      { _id: 'o1', id: 'o1', amount: 100, status: 'paid', createdAt: 1000, items: [{ name: 'A', qty: 1 }] },
      { _id: 'o2', id: 'o2', amount: 50, status: 'pending', createdAt: 3000, items: [{ name: 'B', qty: 2 }] },
      { _id: 'o3', id: 'o3', amount: 30, status: 'paid', createdAt: 2000, items: [] },
      { _id: 'o4', id: 'o4', amount: 999, status: 'closed', createdAt: 500, items: [] }, // 未付·不计 GMV
    ])
    control.seed('qrcodes', [
      { _id: 'q1', status: 'activated' },
      { _id: 'q2', status: 'unused' },
      { _id: 'q3', status: 'activated' },
    ])
    const r = parse(await getDashboard(ctx()))
    expect(r.stats.users).toBe(3)
    expect(r.stats.orders).toBe(4) // count() 全量（含未付）
    expect(r.stats.gmv).toBe(130) // aggregate paid-only：o1(100)+o3(30)；o2 pending / o4 closed 不计（债#32）
    expect(r.stats.codesTotal).toBe(3)
    expect(r.stats.codesActivated).toBe(2)
    expect(r.approx.sampleSize).toBe(1000)
    expect(r.approx.gmv).toBe(false) // GMV 走 aggregate＝精确，恒不标近似（#18续）
    expect(r.recentActivity[0].text).toContain('o2') // 最近动态：最新订单在前（o2 createdAt 3000）
  })

  it('最近动态混合流（S15）：订单/激活/进课/退款按时间合并·最近在前', async () => {
    control.seed('orders', [
      { _id: 'o1', id: 'o1', amount: 198, status: 'paid', createdAt: 5000, items: [] },
      { _id: 'o2', id: 'o2', amount: 50, status: 'paid', createdAt: 1000, items: [] },
    ])
    control.seed('activations', [
      { _id: 'c1', code: 'c1', courseId: 'k1', createdAt: 3000, enteredAt: null }, // 激活 @3000
      { _id: 'c2', code: 'c2', courseId: 'k1', createdAt: 2000, enteredAt: 4000 }, // 进课 @4000（取 enteredAt）
    ])
    control.seed('afterSales', [
      { _id: 'o1__p1', orderId: 'o1', refundAmount: 50, status: 'applied', appliedAt: 6000 }, // 退款申请 @6000
    ])
    const r = parse(await getDashboard(ctx()))
    // 按事件时间倒序合并：6000 退款 / 5000 新订单 / 4000 进课 / 3000 激活 / 1000 新订单
    expect(r.recentActivity.map((e) => e.at)).toEqual([6000, 5000, 4000, 3000, 1000])
    expect(r.recentActivity.map((e) => e.type)).toEqual(['refund', 'order', 'enter', 'activate', 'order'])
    expect(r.recentActivity[0].text).toContain('退款')
    expect(r.recentActivity[2].text).toContain('进课')
  })

  it('钱链异常走定向 where 精确（不从样本 filter）', async () => {
    control.seed('orders', [{ _id: 'o1', id: 'o1', amount: 1, feeMismatch: true, createdAt: 1 }])
    control.seed('afterSales', [
      { _id: 'a1', refundMismatch: true, status: 'refunded' },
      { _id: 'a2', status: 'approved', approvedAt: Date.now() - 2 * 3600_000 }, // 触发超 1h 未回调
      { _id: 'a3', status: 'approved', approvedAt: Date.now() }, // 刚触发·不算 stuck
    ])
    const r = parse(await getDashboard(ctx()))
    expect(r.txAlerts.feeMismatch).toEqual(['o1'])
    expect(r.txAlerts.refundMismatch).toEqual(['a1'])
    expect(r.txAlerts.stuckRefunds).toEqual(['a2'])
  })
})

import { describe, it, expect, beforeEach } from 'vitest'
import cloud, { control } from 'wx-server-sdk'
import { getReconciliation } from '../../packages/cloud/src/functions/admin/adminApi/actions/reconciliation'

// S16 财务对账 Batch 1（内部账）：收支汇总 + 每日流水 + 内部异常。口径同看板 GMV（PAID_STATUSES）。
// 累计总额走 aggregate $.sum 精确（不封顶·债#18续）；每日明细走有界拉取 + JS 按 CST 日分桶（桩不支持
// 服务端 group-by-day），超 CAP 标 approx（同 dashboard SAMPLE 诚实范式）。exceptions 复用 txAlerts 单源。
const db = cloud.database()
const ctx = (data = {}) => ({ db, cloud, data, drafts: {} })
const parse = (res) => JSON.parse(res.body)

// CST 固定时刻（避免跑测时区漂移）
const A = Date.parse('2026-06-20T10:00:00+08:00') // 6/20
const A2 = Date.parse('2026-06-20T12:00:00+08:00') // 6/20 同日
const B = Date.parse('2026-06-21T15:00:00+08:00') // 6/21

beforeEach(() => control.reset())

function seedMoney() {
  control.seed('orders', [
    { _id: 'o1', id: 'o1', amount: 100, status: 'paid', paidAt: A },
    { _id: 'o2', id: 'o2', amount: 30, status: 'paid', paidAt: A2 },
    { _id: 'o3', id: 'o3', amount: 50, status: 'shipped', paidAt: B },
    { _id: 'o4', id: 'o4', amount: 999, status: 'pending' }, // 未付·不计
    { _id: 'o5', id: 'o5', amount: 200, status: 'closed' }, // 关单·不计
  ])
  control.seed('afterSales', [
    { _id: 'a1', orderId: 'o1', refundAmount: 20, status: 'refunded', refundedAt: A },
  ])
}

describe('getReconciliation 内部对账（S16 Batch 1）', () => {
  it('累计精确(aggregate) + 范围汇总 + 每日分桶（收入−退款=净额）', async () => {
    seedMoney()
    const r = parse(await getReconciliation(ctx({ from: '2026-06-20', to: '2026-06-21' })))
    expect(r.ok).toBe(true)
    // 累计（aggregate·全量精确·PAID 口径）：收入 100+30+50=180，退款 20，净 160
    expect(r.cumulative).toEqual({ income: 180, refund: 20, net: 160 })
    // 范围汇总（含两日）：与累计同（本例全在范围内）；笔数 3 付 / 1 退
    expect(r.summary).toEqual({ income: 180, refund: 20, net: 160, orders: 3, refunds: 1 })
    // 每日流水（按 CST 日·升序·仅有动静的日）
    expect(r.daily).toEqual([
      { day: '2026-06-20', income: 130, refund: 20, net: 110, orders: 2, refunds: 1 },
      { day: '2026-06-21', income: 50, refund: 0, net: 50, orders: 1, refunds: 0 },
    ])
    expect(r.approx).toBe(false)
    expect(r.range).toEqual({ from: '2026-06-20', to: '2026-06-21' })
  })

  it('范围筛选只算窗内（cumulative 仍全量）', async () => {
    seedMoney()
    const r = parse(await getReconciliation(ctx({ from: '2026-06-21', to: '2026-06-21' })))
    expect(r.summary).toEqual({ income: 50, refund: 0, net: 50, orders: 1, refunds: 0 })
    expect(r.daily).toEqual([{ day: '2026-06-21', income: 50, refund: 0, net: 50, orders: 1, refunds: 0 }])
    // cumulative 不受范围影响（累计至今·money 锚）
    expect(r.cumulative).toEqual({ income: 180, refund: 20, net: 160 })
  })

  it('内部异常复用 txAlerts 单源（feeMismatch/refundMismatch/stuckRefunds）', async () => {
    control.seed('orders', [{ _id: 'o1', id: 'o1', amount: 1, status: 'paid', paidAt: A, feeMismatch: true }])
    control.seed('afterSales', [
      { _id: 'a1', refundMismatch: true, status: 'refunded', refundedAt: A },
      { _id: 'a2', status: 'approved', approvedAt: Date.now() - 2 * 3600_000 }, // 超 1h 未回调
      { _id: 'a3', status: 'approved', approvedAt: Date.now() }, // 刚触发·不算 stuck
    ])
    const r = parse(await getReconciliation(ctx({ from: '2026-06-20', to: '2026-06-21' })))
    expect(r.exceptions.feeMismatch).toEqual(['o1'])
    expect(r.exceptions.refundMismatch).toEqual(['a1'])
    expect(r.exceptions.stuckRefunds).toEqual(['a2'])
  })

  it('不传 from/to 默认近 30 天·返回 ok + range echo', async () => {
    seedMoney()
    const r = parse(await getReconciliation(ctx({})))
    expect(r.ok).toBe(true)
    expect(typeof r.range.from).toBe('string')
    expect(typeof r.range.to).toBe('string')
    expect(r.cumulative.income).toBe(180) // 累计不受默认窗影响
  })
})

import { describe, it, expect, beforeEach } from 'vitest'
import cloud, { control } from 'wx-server-sdk'
import { getBillMatch } from '../../packages/cloud/src/functions/admin/adminApi/actions/reconciliation'

// S16 外部对账 Batch 3：我方付款单 ⋈ wxBills(微信账单·SUCCESS) by transactionId → 差异显形。
// 四类：✅平 / 🔴微信有我方无（最危险·收了款无单）/ 🔴我方有微信无（仅在该日账单已拉时才算·防误报）/ 🔴金额不符。
// 「账单覆盖日」billDays＝已拉账单的日期；我方单落在未拉账单的日期 → 不判 oursOnly（只是没数据·非差异）。
const db = cloud.database()
const ctx = (data = {}) => ({ db, cloud, data, drafts: {} })
const parse = (res) => JSON.parse(res.body)

const A = Date.parse('2026-06-20T10:00:00+08:00') // 覆盖日
const B = Date.parse('2026-06-21T10:00:00+08:00') // 未覆盖日（无 wxBills）

beforeEach(() => control.reset())

describe('getBillMatch 逐笔对账（S16 Batch 3）', () => {
  it('四类差异 + 覆盖日防误报', async () => {
    control.seed('orders', [
      { _id: 'o1', id: 'o1', amount: 100, status: 'paid', transactionId: '4200001', paidAt: A }, // 平
      { _id: 'o2', id: 'o2', amount: 50, status: 'paid', transactionId: '4200002', paidAt: A }, // 金额不符(微信55)
      { _id: 'o3', id: 'o3', amount: 30, status: 'paid', transactionId: '4200003', paidAt: A }, // 我方有微信无(覆盖日内)
      { _id: 'o4', id: 'o4', amount: 70, status: 'paid', transactionId: '4200004', paidAt: B }, // 未覆盖日·不判
      { _id: 'o5', id: 'o5', amount: 999, status: 'pending', transactionId: 'x', paidAt: A }, // 未付·不计
    ])
    control.seed('wxBills', [
      { _id: '2026-06-20:4200001', date: '2026-06-20', transactionId: '4200001', outTradeNo: 'o1', orderAmount: 100, tradeState: 'SUCCESS' },
      { _id: '2026-06-20:4200002', date: '2026-06-20', transactionId: '4200002', outTradeNo: 'o2', orderAmount: 55, tradeState: 'SUCCESS' },
      { _id: '2026-06-20:4200099', date: '2026-06-20', transactionId: '4200099', outTradeNo: 'oX', orderAmount: 200, tradeState: 'SUCCESS' }, // 微信有我方无
    ])
    const r = parse(await getBillMatch(ctx({ from: '2026-06-20', to: '2026-06-21' })))
    expect(r.ok).toBe(true)
    expect(r.summary).toEqual({ matched: 1, wxOnly: 1, oursOnly: 1, amountMismatch: 1 })
    expect(r.discrepancies.wxOnly.map((x) => x.transactionId)).toEqual(['4200099'])
    expect(r.discrepancies.oursOnly.map((x) => x.id)).toEqual(['o3'])
    expect(r.discrepancies.amountMismatch[0]).toMatchObject({ id: 'o2', ourAmount: 50, wxAmount: 55 })
    expect(r.billDays).toEqual(['2026-06-20']) // 仅 06-20 拉了账单
  })

  it('无 wxBills 时全 0（未拉账单·不误报 oursOnly）', async () => {
    control.seed('orders', [{ _id: 'o1', id: 'o1', amount: 100, status: 'paid', transactionId: '4200001', paidAt: A }])
    const r = parse(await getBillMatch(ctx({ from: '2026-06-20', to: '2026-06-21' })))
    expect(r.summary).toEqual({ matched: 0, wxOnly: 0, oursOnly: 0, amountMismatch: 0 })
    expect(r.billDays).toEqual([])
  })
})

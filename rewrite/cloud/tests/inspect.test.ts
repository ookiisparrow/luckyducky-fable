// 黄金 观测-巡检 §B：巡检机「主动核对不变量·探出静默失败」（守卫 rw-inspect-golden）。
// 不依赖 AI 的定时/手动体检：跑一遍检查目录（A 基建存活 + B 业务不变量）→ 写 inspectRuns 体检报告
// → 每条红自动落 recordAnomaly（违反→bug 账本闭环）。只读——绝不改业务集合（「现在只读看护线上」铁律）。
import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { runInspection } from '../src/kit'
import { COLLECTIONS } from '@ldrw/shared'

const HOUR = 3600 * 1000

beforeEach(() => control.reset())

describe('runInspection（巡检机·探出静默失败）', () => {
  it('大白话：干净数据→全绿·不落异常·写一条巡检史', async () => {
    control.seed(COLLECTIONS.config, [{ _id: 'x', v: 1 }])
    control.seed(COLLECTIONS.orders, [{ _id: 'A', status: 'done', amount: 100, paidAt: 111 }])
    const run = await runInspection('manual')
    expect(run.summary.red).toBe(0)
    expect(run.trigger).toBe('manual')
    expect(control.dump(COLLECTIONS.inspectRuns).length).toBe(1)
    expect(control.dump(COLLECTIONS.anomalies).length).toBe(0)
  })

  it('大白话：退款超实付→钱守恒红 + 落一条高危 anomaly（违反→账本闭环）', async () => {
    control.seed(COLLECTIONS.orders, [{ _id: 'A', status: 'paid', amount: 100, paidAt: Date.now() }])
    control.seed(COLLECTIONS.afterSales, [
      { _id: 'A__l1', orderId: 'A', status: 'refunded', refundAmount: 80 },
      { _id: 'A__l2', orderId: 'A', status: 'refunded', refundAmount: 50 }, // 80+50=130 > 100 实付
    ])
    const run = await runInspection('timer')
    const money = run.results.find((r) => r.id === 'money-conserved')!
    expect(money.status).toBe('red')
    expect(money.samples).toContain('A')
    const an = control.dump(COLLECTIONS.anomalies)
    expect(an.length).toBe(1)
    expect(an[0].severity).toBe('high')
  })

  it('大白话：付款超 72h 未发货→卡单红', async () => {
    control.seed(COLLECTIONS.orders, [{ _id: 'A', status: 'paid', amount: 100, transactionId: 'wxA', paidAt: Date.now() - 80 * HOUR }])
    const run = await runInspection('timer')
    const stuck = run.results.find((r) => r.id === 'stuck-order')!
    expect(stuck.status).toBe('red')
    expect(stuck.samples).toContain('A')
  })

  it('大白话：mock 单（无真微信 transactionId=演示/非真钱）不算卡单——只报真付款', async () => {
    control.seed(COLLECTIONS.orders, [{ _id: 'M', status: 'paid', amount: 100, paidAt: Date.now() - 80 * HOUR }]) // 无 transactionId=mock/演示
    const run = await runInspection('timer')
    expect(run.results.find((r) => r.id === 'stuck-order')!.status).toBe('green')
  })

  it('大白话：真付款但正在退款（有活跃售后）不算卡单——不是发货义务', async () => {
    control.seed(COLLECTIONS.orders, [{ _id: 'R', status: 'paid', amount: 100, transactionId: 'wxR', paidAt: Date.now() - 80 * HOUR }])
    control.seed(COLLECTIONS.afterSales, [{ _id: 'R__l1', orderId: 'R', status: 'approved', refundAmount: 100 }])
    const run = await runInspection('timer')
    expect(run.results.find((r) => r.id === 'stuck-order')!.status).toBe('green')
  })

  it('大白话：refund_required 死信单（钱已收待人工退款没人管）→卡单红+高危告警', async () => {
    control.seed(COLLECTIONS.orders, [{ _id: 'D', status: 'refund_required', amount: 100, paidAt: Date.now() }])
    const run = await runInspection('timer')
    const stuck = run.results.find((r) => r.id === 'stuck-order')!
    expect(stuck.status).toBe('red')
    expect(stuck.samples).toContain('D')
    expect(control.dump(COLLECTIONS.anomalies).some((a: any) => a.severity === 'high')).toBe(true)
  })

  it('大白话：空库/集合缺失也不抛、给出完整三查结果（fail-soft·巡检不反噬）', async () => {
    const run = await runInspection('timer')
    expect(run.results.length).toBe(3)
    expect(run.summary).toBeDefined()
  })

  it('大白话：只读巡检·绝不改业务集合（看护铁律·只新增 inspectRuns/anomalies）', async () => {
    control.seed(COLLECTIONS.orders, [{ _id: 'A', status: 'paid', amount: 100, paidAt: 111 }])
    await runInspection('timer')
    expect(control.dump(COLLECTIONS.orders)).toEqual([{ _id: 'A', status: 'paid', amount: 100, paidAt: 111 }])
  })
})

// 系统组+钱组补齐映射（守卫 rw-admin-system-ui-golden）：批次激活率不除零/webhook 预检同云端正则/
// 对账 approx 诚实透传/wxOnly 标红/库存不限量不显 0/409 冲突人话。
import { describe, it, expect } from 'vitest'
import { mapAgents, mapBatches, webhookOk, mapRecon, mapBillMatch, mapStock, stockErrorText } from '../src/lib/mapSystem'

describe('外包账号与批次', () => {
  it('大白话：账号行归一（无 id 剔除）；批次激活率算百分比、空批显 — 不除零', () => {
    expect(mapAgents([{ id: 'agent-1', name: '外包一号', disabled: false }, { noid: 1 }, null])).toHaveLength(1)
    const rows = mapBatches([
      { batchId: 'b1', total: 30, activated: 6, createdAt: 1783046400000 },
      { batchId: 'b-empty', total: 0, activated: 0 },
    ])
    expect(rows[0].rateLabel).toBe('20%')
    expect(rows[1].rateLabel).toBe('—') // 不除零
  })

  it('大白话：webhook 只认企微群机器人地址；空=清除合法；野地址拒', () => {
    expect(webhookOk('')).toBe(true)
    expect(webhookOk('https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc-123')).toBe(true)
    expect(webhookOk('https://evil.com/hook')).toBe(false)
    expect(webhookOk('http://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=x')).toBe(false) // http 不行
  })
})

describe('对账映射（approx 诚实·wxOnly 最危险）', () => {
  it('大白话：累计三卡金额两位小数；窗内触顶标近似；「微信有我方无」大于 0 必标红', () => {
    const recon = mapRecon({
      ok: true,
      cumulative: { income: 150, refund: 30, net: 120 },
      daily: [{ day: '2026-07-01', income: 100, refund: 0, net: 100, orders: 1, refunds: 0 }],
      approx: true,
      exceptions: { feeMismatch: ['o-bad'], refundMismatch: [], stuckRefunds: ['a-stuck'] },
    })!
    expect(recon.cumulative[2]).toEqual({ label: '净额', value: '¥120.00' })
    expect(recon.approxNote).toContain('近似')
    // B2 修：exceptions 是 {feeMismatch,refundMismatch,stuckRefunds} 对象·结构化成带单号明细（有则渲染·空类不显）
    expect(recon.exceptions).toEqual([
      { label: '金额不符单（发货前须核对流水解除）', ids: ['o-bad'] },
      { label: '审批后卡单（死信·退款未走通）', ids: ['a-stuck'] },
    ])
    const clean = mapRecon({ ok: true, cumulative: { income: 0, refund: 0, net: 0 }, daily: [], approx: false })!
    expect(clean.approxNote).toBe('')
    expect(clean.exceptions).toEqual([]) // 无异常空数组·不吓人
    const m = mapBillMatch({ ok: true, summary: { matched: 5, wxOnly: 1, oursOnly: 0, amountMismatch: 0 }, discrepancies: { wxOnly: [{ transactionId: 'tx-ghost', amount: 5, date: '2026-07-01' }], oursOnly: [], amountMismatch: [] } })!
    expect(m.summary[1]).toMatchObject({ danger: true }) // wxOnly>0 标红
    expect(m.summary[0].danger).toBeFalsy() // 已平不标红
    expect(m.wxOnly[0].amount).toBe('¥5.00')
    expect(mapBillMatch({ ok: false })).toBeNull()
  })
})

describe('库存映射与保存错误人话', () => {
  it('大白话：null=不限量（绝不显成 0）；触顶如实标非全量；409 冲突说「刚被改过·拒绝覆盖」', () => {
    const { rows, truncNote } = mapStock(
      [
        { _id: 'p1__', productId: 'p1', spec: '', stock: 5, updatedAt: 1000 },
        { _id: 'p2__', productId: 'p2', spec: '', stock: null, updatedAt: 1000 },
        { noid: 1 },
      ],
      true
    )
    expect(rows).toHaveLength(2)
    expect(rows[0].stockLabel).toBe('5')
    expect(rows[1].stockLabel).toBe('不限量') // null 不显 0
    expect(truncNote).toContain('非全量')
    expect(mapStock([], false).truncNote).toBe('')
    expect(stockErrorText('STOCK_CONFLICT')).toContain('拒绝覆盖')
    expect(stockErrorText('', 409)).toContain('拒绝覆盖')
    expect(stockErrorText('BAD_STOCK')).toContain('非负整数')
    expect(stockErrorText('X_UNKNOWN')).toContain('X_UNKNOWN') // 原文兜底
  })
})

// 部分退款单进发货工作台：退款按件退，已退的件不进拣货、不进标签清单，没退的件照装；
// 已退的件要明着告诉操作员「已退款，别装」。
import { describe, it, expect } from 'vitest'
import { pickSummary, labelData, buildLabelHtml } from '../src/lib/fulfill'

const order = (items: any[]) => ({
  id: '2026070413011234',
  createdAt: 100,
  address: { name: '赵四', phone: '13800000000', region: '贵州省', detail: '某路1号' },
  items,
})

describe('已退的件不进履约面', () => {
  it('大白话：整行退了——拣货和标签都只剩小熊，线包单列「已退款·别装」', () => {
    const o = order([
      { name: '小熊', qty: 1 },
      { name: '线包', qty: 2, refundedQty: 2 },
    ])
    const s = pickSummary([o])
    expect(s.orderCount).toBe(1)
    expect(s.totalQty).toBe(1)
    expect(s.products).toEqual([{ name: '小熊', qty: 1 }])
    const l = labelData(o)
    expect(l.lines).toEqual([{ name: '小熊', qty: 1 }])
    expect(l.totalQty).toBe(1)
    expect(l.refundedLines).toEqual([{ name: '线包', qty: 2 }])
    const html = buildLabelHtml([{ ...l, qrDataUrl: 'data:,' }])
    expect(html).toContain('已退款·别装：线包')
  })

  it('大白话：线包买 2 件、进过课的 1 件没退——照装 1 件，另 1 件标别装', () => {
    const o = order([
      { name: '小熊', qty: 1 },
      { name: '线包', qty: 2, refundedQty: 1 },
    ])
    const l = labelData(o)
    expect(l.lines).toEqual([
      { name: '小熊', qty: 1 },
      { name: '线包', qty: 1 },
    ])
    expect(l.totalQty).toBe(2)
    expect(l.refundedLines).toEqual([{ name: '线包', qty: 1 }])
    expect(pickSummary([o]).totalQty).toBe(2)
  })
})

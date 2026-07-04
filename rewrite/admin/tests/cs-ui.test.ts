// 客服组映射（守卫 rw-admin-cs-ui-golden）：时长人话/报表 approx 诚实透传/360 单面板失败隔离/
// 命中依据中文/kb 行归一/满意度分布。
import { describe, it, expect } from 'vitest'
import { msHuman, mapReport, mapPanels, matchLabel, normalizeKb, mapCsat, mapMessages } from '../src/lib/mapCs'

describe('时长人话与报表', () => {
  it('大白话：秒/分/小时逐级人话；非法回 —；报表 approx 时明标「估算」，否则标「全量精确」', () => {
    expect(msHuman(32_000)).toBe('32 秒')
    expect(msHuman(250_000)).toBe('4 分 10 秒')
    expect(msHuman(7_500_000)).toBe('2 小时 5 分')
    expect(msHuman('abc')).toBe('—')
    const exact = mapReport({ ok: true, sampleSize: 300, approx: false, volume: { messages: 300, inbound: 2, outbound: 1, customers: 2 }, response: {}, sla: {} })!
    expect(exact.sampleNote).toContain('全量精确')
    const approx = mapReport({ ok: true, sampleSize: 1000, approx: true, volume: {}, response: {}, sla: {} })!
    expect(approx.sampleNote).toContain('估算') // 诚实标注
    expect(mapReport({ ok: false })).toBeNull()
  })
})

describe('360 面板（单面板失败隔离）', () => {
  it('大白话：一个面板挂了只标那个面板、其余照渲染；profile 字段有人话标签', () => {
    const panels = mapPanels({
      ok: true,
      panels: [
        { key: 'profile', label: '画像', order: 5, data: { orderCount: 3, totalSpent: 150.3 } },
        { key: 'orders', label: '订单', order: 10, data: null, error: 'PANEL_FETCH_FAIL' },
        { key: 'activation', label: '激活', order: 20, data: [{ a: 1 }, { a: 2 }] },
      ],
    })
    expect(panels).toHaveLength(3)
    expect(panels[0].failed).toBe(false)
    expect(panels[0].rows.find((r) => r.k === '订单数')!.v).toBe('3') // 人话标签
    expect(panels[1].failed).toBe(true) // 只标挂的
    expect(panels[2].failed).toBe(false)
    expect(panels[2].rows).toEqual([{ k: '条数', v: '2' }]) // 数组面板给条数
    expect(mapPanels(null)).toEqual([])
  })

  it('大白话：命中依据转中文（openid→账号/orderId→订单号）', () => {
    expect(matchLabel(['openid', 'orderId'])).toBe('账号/订单号')
    expect(matchLabel(['phone'])).toBe('手机号')
    expect(matchLabel(undefined)).toBe('')
  })
})

describe('kb/满意度/消息归一', () => {
  it('大白话：kb 行缺字段归默认（enabled 默认真·分类默认 other）；满意度五档倒序；消息方向中文·非文本给类型占位', () => {
    const kb = normalizeKb([{ key: 'f1', question: 'q', answer: 'a' }, null])
    expect(kb).toEqual([{ key: 'f1', question: 'q', answer: 'a', category: 'other', enabled: true, order: 0 }])
    const csat = mapCsat({ ok: true, total: 3, avg: 4.67, dist: { 5: 2, 4: 1 }, withNote: 1, approx: false })!
    expect(csat.dist[0]).toEqual({ star: '5 星', n: 2 })
    expect(csat.dist[4]).toEqual({ star: '1 星', n: 0 })
    expect(csat.approxNote).toBe('')
    expect(mapCsat({ ok: false })).toBeNull()
    const msgs = mapMessages([
      { id: 'm1', direction: 'in', text: '在吗', at: 1783046400000 },
      { id: 'm2', direction: 'out', msgtype: 'image', text: '' },
    ])
    expect(msgs[0].who).toBe('客户')
    expect(msgs[1].who).toBe('客服')
    expect(msgs[1].text).toBe('[image]') // 非文本占位·不空行
  })
})

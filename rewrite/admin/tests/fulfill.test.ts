// 发货工作台纯逻辑黄金基准（守卫 rw-admin-fulfill-golden·1:1 承接旧线 tests/admin/fulfill.test.js）：
// 扫码分拣安全判序 / 拣货汇总 / 标签派生 / 短码 / 打印 HTML。换皮回归还原批 Fulfill。
import { describe, it, expect } from 'vitest'
import { classifyScan, pickSummary, labelData, shortCode, buildLabelHtml, PAPER_PRESETS } from '../src/lib/fulfill'

describe('扫码分拣（安全判序·勿调换）', () => {
  const paid = new Set(['2026070413011234', '2026070413015678'])
  it('大白话：空→empty；在队列→order；id 形状但不在队列→挡误发；其余→当运单号', () => {
    expect(classifyScan('', paid)).toEqual({ type: 'empty' })
    expect(classifyScan('  ', paid)).toEqual({ type: 'empty' })
    expect(classifyScan('2026070413011234', paid)).toEqual({ type: 'order', id: '2026070413011234' })
    // id 形状合法但不在待发货队列（已发货箱的旧内部码）——必须单独成类，别当运单号发给当前选中单
    expect(classifyScan('2026070413019999', paid)).toEqual({ type: 'order-not-in-queue', id: '2026070413019999' })
    expect(classifyScan('SF1234567890', paid)).toEqual({ type: 'tracking', trackingNo: 'SF1234567890' })
    // 无队列集也能分拣（tracking 兜底）
    expect(classifyScan('YT99', undefined)).toEqual({ type: 'tracking', trackingNo: 'YT99' })
  })
})

describe('短码', () => {
  it('大白话：16 位订单号→MMdd-随机段；其余原样', () => {
    expect(shortCode('2026070413011234')).toBe('0704-1234')
    expect(shortCode('SF123')).toBe('SF123')
    expect(shortCode('')).toBe('')
  })
})

describe('拣货汇总', () => {
  it('大白话：全部待发货按产品名合并数量、按量降序；金额异常计数；最早一单；脏行剔除', () => {
    const s = pickSummary([
      { id: 'a', createdAt: 200, items: [{ name: '小熊', qty: 2 }, { name: '小鸭', qty: 1 }] },
      { id: 'b', createdAt: 100, feeMismatch: true, items: [{ name: '小熊', qty: 3 }, { name: '', qty: 5 }, { name: '小猫', qty: 0 }] },
    ])
    expect(s.orderCount).toBe(2)
    expect(s.totalQty).toBe(6) // 2+1+3（空名/0量剔除）
    expect(s.mismatchCount).toBe(1)
    expect(s.earliestCreatedAt).toBe(100)
    expect(s.products).toEqual([
      { name: '小熊', qty: 5 }, // 合并 2+3·量最大排首
      { name: '小鸭', qty: 1 },
    ])
    expect(pickSummary('garbage').products).toEqual([])
  })
})

describe('标签派生（不带金额/隐私外泄·收件人全显给快递）', () => {
  it('大白话：短码/收件人/地址/清单合并/总件数；只含发货字段', () => {
    const l = labelData({
      id: '2026070413011234',
      address: { name: '赵四', phone: '13800000000', region: '贵州省', detail: '某路1号' },
      items: [{ name: '小熊', qty: 2 }, { name: '小熊', qty: 1 }],
    })
    expect(l.shortCode).toBe('0704-1234')
    expect(l.name).toBe('赵四')
    expect(l.phone).toBe('13800000000') // 标签给快递员看·不掩码（与列表掩码相反·刻意）
    expect(l.addressText).toBe('贵州省 某路1号')
    expect(l.lines).toEqual([{ name: '小熊', qty: 3 }]) // 同名合并
    expect(l.totalQty).toBe(3)
  })
})

describe('打印 HTML', () => {
  it('大白话：含短码·按预设纸张尺寸·转义防注入·>6 行 dense 缩字号', () => {
    const html = buildLabelHtml(
      [{ ...labelData({ id: '2026070413011234', address: { name: '<b>x</b>' }, items: [{ name: 'a', qty: 1 }] }), qrDataUrl: 'data:img' }],
      PAPER_PRESETS[1],
    )
    expect(html).toContain('0704-1234')
    expect(html).toContain('76mm 130mm') // @page size 来自预设
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;') // HTML 转义（防标签注入）
    expect(html).not.toContain('<b>x</b>')
    const many = buildLabelHtml(
      [{ ...labelData({ id: 'x', items: Array.from({ length: 7 }, (_, i) => ({ name: 'p' + i, qty: 1 })) }), qrDataUrl: 'd' }],
      PAPER_PRESETS[0],
    )
    expect(many).toContain('class="label dense"') // >6 行密排
  })
})

import { describe, it, expect } from 'vitest'
import {
  FULFILL_STEP_NAMES,
  COMPANIES,
  PAPER_PRESETS,
  shortCode,
  pickSummary,
  labelData,
  classifyScan,
  buildLabelHtml,
} from '../../packages/admin/src/utils/fulfill.js'

// 发货工作台纯逻辑（R32·零后端）：拣货汇总 / 内部标签派生 / 扫码分类 / 打印 HTML。
// 最要命的不变量在 classifyScan——扫到「订单 id 形状但不在待发货队列」的码（比如已发货箱的旧内部码）
// 绝不能落到 tracking 分支：一旦落了，别单的箱码会被当运单号发给当前选中的订单。

const mkOrder = (over = {}) => ({
  id: '2026070310001234',
  status: 'paid',
  createdAt: 1751500000000,
  feeMismatch: false,
  address: { name: '张三', phone: '13800000000', region: '浙江省 杭州市 西湖区', detail: '文一路 1 号' },
  items: [
    { productId: 'prod-1', name: '小棉鸭礼盒', spec: '', qty: 1 },
    { productId: 'prod-4', name: '小棉鸭 · 单只', spec: '', qty: 2 },
  ],
  ...over,
})

describe('fulfill 常量', () => {
  it('三步名与两档纸张预设齐全，物流公司单源非空', () => {
    expect(FULFILL_STEP_NAMES).toHaveLength(3)
    expect(PAPER_PRESETS.map((p) => p.key)).toEqual(['100x180', '76x130'])
    expect(COMPANIES.length).toBeGreaterThan(0)
  })
})

describe('shortCode（人眼短编号）', () => {
  it('16 位订单 id → MMdd-随机段', () => {
    expect(shortCode('2026070314304837')).toBe('0703-4837')
  })
  it('非 16 位数字原样返回不炸', () => {
    expect(shortCode('abc')).toBe('abc')
    expect(shortCode('')).toBe('')
    expect(shortCode('123')).toBe('123')
  })
})

describe('pickSummary（拣货汇总）', () => {
  it('跨单同产品名合并求和，按数量降序', () => {
    const orders = [
      mkOrder(),
      mkOrder({
        id: '2026070310005678',
        items: [{ productId: 'prod-4', name: '小棉鸭 · 单只', spec: '', qty: 3 }],
      }),
    ]
    const s = pickSummary(orders)
    expect(s.orderCount).toBe(2)
    expect(s.totalQty).toBe(6)
    expect(s.products).toEqual([
      { name: '小棉鸭 · 单只', qty: 5 },
      { name: '小棉鸭礼盒', qty: 1 },
    ])
  })
  it('同名不同 spec 也并成一行（产品都是封装好的，标签/备货不按规格分）', () => {
    const s = pickSummary([
      mkOrder({
        items: [
          { name: '进阶套装', spec: '红', qty: 1 },
          { name: '进阶套装', spec: '蓝', qty: 2 },
        ],
      }),
    ])
    expect(s.products).toEqual([{ name: '进阶套装', qty: 3 }])
  })
  it('earliestCreatedAt 取最小、mismatchCount 数 feeMismatch 单', () => {
    const s = pickSummary([
      mkOrder({ createdAt: 300 }),
      mkOrder({ id: '2026070310005678', createdAt: 100, feeMismatch: true }),
    ])
    expect(s.earliestCreatedAt).toBe(100)
    expect(s.mismatchCount).toBe(1)
  })
  it('空数组 → 全零不炸；缺 items 的脏单容忍跳过', () => {
    expect(pickSummary([])).toEqual({
      orderCount: 0,
      totalQty: 0,
      mismatchCount: 0,
      earliestCreatedAt: null,
      products: [],
    })
    const s = pickSummary([mkOrder({ items: undefined })])
    expect(s.orderCount).toBe(1)
    expect(s.products).toEqual([])
  })
})

describe('labelData（标签数据派生）', () => {
  it('短编号/收件人/地址拼接/清单/总件数齐全', () => {
    const d = labelData(mkOrder())
    expect(d.id).toBe('2026070310001234')
    expect(d.shortCode).toBe('0703-1234')
    expect(d.name).toBe('张三')
    expect(d.phone).toBe('13800000000')
    expect(d.addressText).toBe('浙江省 杭州市 西湖区 文一路 1 号')
    expect(d.lines).toEqual([
      { name: '小棉鸭礼盒', qty: 1 },
      { name: '小棉鸭 · 单只', qty: 2 },
    ])
    expect(d.totalQty).toBe(3)
  })
  it('同名行合并；不含金额等内部字段', () => {
    const d = labelData(
      mkOrder({
        amount: 296,
        items: [
          { name: '进阶套装', spec: '红', qty: 1, price: 399 },
          { name: '进阶套装', spec: '蓝', qty: 2, price: 399 },
        ],
      }),
    )
    expect(d.lines).toEqual([{ name: '进阶套装', qty: 3 }])
    expect(d).not.toHaveProperty('amount')
    expect(JSON.stringify(d)).not.toContain('399')
  })
})

describe('classifyScan（扫码分类·安全判序）', () => {
  const queue = new Set(['2026070310001234', '2026070310005678'])
  it('空白/纯空格 → empty', () => {
    expect(classifyScan('', queue).type).toBe('empty')
    expect(classifyScan('   ', queue).type).toBe('empty')
  })
  it('在队列的 id → order（带 id）', () => {
    expect(classifyScan('2026070310001234', queue)).toEqual({ type: 'order', id: '2026070310001234' })
  })
  it('扫码枪 CR/CRLF 后缀 trim 后仍判 order', () => {
    expect(classifyScan(' 2026070310001234\r\n', queue).type).toBe('order')
  })
  it('id 形状合法但不在队列（已发货箱的旧码）→ order-not-in-queue，绝不落 tracking', () => {
    const r = classifyScan('2026070314304837', queue)
    expect(r).toEqual({ type: 'order-not-in-queue', id: '2026070314304837' })
  })
  it('16 位纯数字但非 id 形状（月=88）→ tracking（真运单号可能恰 16 位）', () => {
    expect(classifyScan('2026880314304837', queue).type).toBe('tracking')
  })
  it('随机段以 0 开头（orderNo 随机段 ∈1000-9999 不可能）→ tracking', () => {
    expect(classifyScan('2026070314300123', queue).type).toBe('tracking')
  })
  it('常见运单号形态 → tracking 且带 trackingNo', () => {
    expect(classifyScan('SF1234567890123', queue)).toEqual({ type: 'tracking', trackingNo: 'SF1234567890123' })
    expect(classifyScan('773123456789', queue).type).toBe('tracking')
    expect(classifyScan('78912345678901234', queue).type).toBe('tracking')
  })
})

describe('buildLabelHtml（打印页 HTML）', () => {
  const labels = [
    { ...labelData(mkOrder()), qrDataUrl: 'data:image/png;base64,AAA' },
    {
      ...labelData(mkOrder({ id: '2026070310005678' })),
      qrDataUrl: 'data:image/png;base64,BBB',
    },
  ]
  const preset = PAPER_PRESETS[0]
  it('N 单 N 个 .label、@page 含预设尺寸、每标签分页', () => {
    const html = buildLabelHtml(labels, preset)
    expect(html.match(/class="label/g)).toHaveLength(2)
    expect(html).toContain('size: 100mm 180mm')
    expect(html.match(/page-break-after/g)?.length).toBeGreaterThan(0)
  })
  it('含 QR 图/短编号/收件人/产品行/共 N 件；不含金额符号', () => {
    const html = buildLabelHtml(labels, preset)
    expect(html).toContain('data:image/png;base64,AAA')
    expect(html).toContain('0703-1234')
    expect(html).toContain('张三')
    expect(html).toContain('13800000000')
    expect(html).toContain('小棉鸭礼盒')
    expect(html).toContain('共 3 件')
    expect(html).not.toContain('￥')
    expect(html).not.toContain('金额')
  })
  it('HTML 特殊字符转义（地址/姓名带 <> 不破版）', () => {
    const evil = labelData(mkOrder({ address: { name: 'a<b>&c', phone: '1', region: 'r', detail: 'd' } }))
    const html = buildLabelHtml([{ ...evil, qrDataUrl: 'data:,x' }], preset)
    expect(html).not.toContain('a<b>&c')
    expect(html).toContain('a&lt;b&gt;&amp;c')
  })
  it('产品超过 6 行出 dense 缩字号', () => {
    const many = labelData(
      mkOrder({ items: Array.from({ length: 7 }, (_, i) => ({ name: `品${i}`, spec: '', qty: 1 })) }),
    )
    const html = buildLabelHtml([{ ...many, qrDataUrl: 'data:,x' }], preset)
    expect(html).toContain('dense')
  })
})

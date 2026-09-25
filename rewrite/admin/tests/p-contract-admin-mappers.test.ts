// 后台映射 ↔ adminApi 真实响应（Issue #388）：喂的是 tests/contracts/admin-money.json 的 sample——它由云端
// p-contract-admin-shape.test.ts 对着真 adminApi 整体全等锁住（单号归一），不是手写 fixture。云端改键、单位或状态值，
// 云端测试先红，改契约后这里再红，逼着后台映射跟上。金额期望值按契约 units：订单/售后/对账金额是元，paidFee 是分。
import { describe, it, expect } from 'vitest'
import CONTRACT from '../../../tests/contracts/admin-money.json'
import { mapOrderRows, mapRefundRows, mapOverrideOrder, mapDashboard, deriveDashboardTodos, refundVerdict } from '../src/lib/mapMoney'
import { mapRecon, mapBillMatch, mapStock } from '../src/lib/mapSystem'
import { dateTime } from '../src/lib/format'

type Json = Record<string, any>
const S = (name: string): Json => (CONTRACT.cases as unknown as Record<string, { sample: Json }>)[name].sample
const A = '2026070112000001' // 已发货
const B = '2026070112000002' // 已全额退款
const C = '2026070112000003' // 少付 100 元的支付异常单
const D = '2026070112000004' // 售后待审核

describe('订单映射（listOrders 真实形状）', () => {
  it('已发货单：金额按元显示、物流/交易号取对字段、只能改单号不能再发、列表手机号打码', () => {
    const src = S('listOrders').list[0]
    const [row] = mapOrderRows(S('listOrders').list)
    expect(row).toMatchObject({
      id: A,
      status: 'shipped',
      statusLabel: '已发货',
      amountLabel: '¥198.00',
      summary: '小鸭礼盒',
      count: 1,
      trackingNo: 'SF001',
      company: '顺丰',
      transactionId: 'wx-A',
      wxShipUploaded: true,
      canShip: false,
      canModify: true,
      feeMismatch: false,
      paymentException: false,
      paidFeeMissing: false,
      refundHold: false,
      addrName: '张三',
      addrPhone: '13800000000',
      addrRegion: '浙江·杭州',
      addrDetail: 'xx 路 1 号',
      ackRefundedQty: {},
      createdAtMs: src.createdAt,
      paidAtMs: src.paidAt,
      shippedAtMs: src.shippedAt,
      doneAtMs: null,
    })
    expect(row.address).toContain('138****0000')
    expect(row.address).not.toContain('13800000000')
    expect(row.items).toEqual([{ productId: 'p1', lineKey: 'p1__', name: '小鸭礼盒', spec: '', qty: 1, refundedQty: 0 }])
  })

  it('支付异常单：金额显示实际到账 paidFee（10000 分 → ¥100.00），不是订单标价 ¥198.00；不可发货', () => {
    const [row] = mapOrderRows(S('listOrders:payment_exception').list)
    expect(row).toMatchObject({
      id: C,
      status: 'payment_exception',
      statusLabel: '支付异常待处理',
      amountLabel: '¥100.00',
      paymentException: true,
      paidFeeMissing: false,
      feeMismatch: true,
      canShip: false,
      canModify: false,
    })
  })

  it('越规退款查单：标价/商品价/行单价都按元显示，行键用 lineId', () => {
    expect(mapOverrideOrder(S('listOrders').list, A)).toEqual({
      id: A,
      statusLabel: '已发货',
      buyerName: '张三',
      buyerPhone: '13800000000',
      amountLabel: '¥198.00',
      goodsLabel: '¥198.00',
      lines: [{ lineId: 'p1__', label: '小鸭礼盒 ×1 · ¥198.00' }],
    })
  })

  it('订单抽屉的激活态按商品 id 取得到（Orders.vue actOf(it.productId)）', () => {
    const [row] = mapOrderRows(S('listOrders').list)
    const act = S('getOrderDetail').activations[row.items[0].productId]
    expect(act).toMatchObject({ activated: false, entered: false })
  })
})

describe('售后映射（listRefunds / getRefundDetail 真实形状）', () => {
  it('待审核：退款额按元显示、可裁决、买家信息来自后端 join 的 buyerName/buyerPhone', () => {
    const src = S('listRefunds').list[0]
    expect(mapRefundRows(S('listRefunds').list)).toEqual([
      {
        id: D + '__p1__',
        orderId: D,
        status: 'applied',
        statusLabel: '待审核',
        what: '小鸭礼盒 ×1',
        refundAmountLabel: '¥198.00',
        reason: '尺寸不合适',
        timeLabel: dateTime(src.appliedAt),
        canDecide: true,
        refundedAtLabel: '',
        rejectReason: '',
        buyerName: '张三',
        buyerPhone: '13800000000',
        buyerMasked: '138****0000',
      },
    ])
  })

  it('已退款：不可再裁决，显示到账时间', () => {
    const src = S('listRefunds:refunded').list[0]
    const [row] = mapRefundRows(S('listRefunds:refunded').list)
    expect(row).toMatchObject({ orderId: B, status: 'refunded', statusLabel: '已退款', refundAmountLabel: '¥198.00', canDecide: false })
    expect(row.refundedAtLabel).toBe(dateTime(src.refundedAt))
    expect(row.refundedAtLabel).not.toBe('')
  })

  it('审核判据：按 getRefundDetail 的 lineRefundable/activation.entered/refundableQty 出文案（Refunds.vue 取这三个字段）', () => {
    const d = S('getRefundDetail')
    expect(typeof d.activation.activated).toBe('boolean')
    expect(refundVerdict({ lineRefundable: d.lineRefundable, entered: d.activation.entered, refundableQty: d.refundableQty })).toMatchObject({
      tone: 'ok',
      title: '本单此行仍可退',
    })
  })
})

describe('看板映射（getDashboard / 计数 / 库存 真实形状）', () => {
  it('成交额按元显示、漏斗逐环转化、金额不符单进警报', () => {
    const vm = mapDashboard(S('getDashboard'))!
    expect(vm.cards.find((c) => c.label === '成交额（已付）')).toMatchObject({ value: '¥594.00', note: '精确' })
    expect(vm.cards.find((c) => c.label === '订单总数')!.value).toBe('4')
    expect(vm.funnel.map((f) => [f.value, f.sub])).toEqual([
      ['4', ''],
      ['3', '较上环 75%'],
      ['0', '较上环 0%'],
    ])
    expect(vm.alerts).toEqual([{ label: '金额不符单', ids: [C] }])
    expect(vm.hot).toEqual([{ name: '第一课 · 起针', count: 1 }])
    expect(vm.recent.length).toBe(S('getDashboard').recentActivity.length)
  })

  it('异常查询失败（txAlerts.partial=true、三数组空）时 mapDashboard 标 alertsPartial，页面不把「没查到」显示成无告警（病根#14）', () => {
    const d = structuredClone(S('getDashboard'))
    d.txAlerts = { feeMismatch: [], refundMismatch: [], stuckRefunds: [], partial: true }
    const vm = mapDashboard(d)!
    expect(vm.alerts).toEqual([])
    expect(vm.alertsPartial).toBe(true)
  })

  it('待处理计数：待发货取 counts.paid、待审退款取 counts.applied；库存按 per-SKU 阈值判（库存 3 > 阈值 2 不算低）', () => {
    // 已知缺口：ship: 2 锁的是现状不是期望——deriveDashboardTodos 仍读 counts.paid（status=paid 的全部单），
    // 把全额退款仍停在 paid 的 B、售后待审的 D 也算进去；真能发的是 getDashboard.toShip（契约里是 0）。
    // 改读 toShip 后这里传 dashboard: S('getDashboard')、期望改成 ship: 0。
    const t = deriveDashboardTodos({
      orderCounts: S('orderCounts'),
      refundCounts: S('refundCounts'),
      inventory: S('listInventory'),
      drafts: { ok: true, rows: [] },
      low: 10,
    })
    expect(t).toEqual({ ship: 2, refund: 1, lowStock: 0, prep: 0, partial: false })
  })

  it('页面直读的原始字段在契约里（不经映射）：计数的 partial、列表的 nextCursor/hasMore', () => {
    // Orders/Refunds.vue 与 deriveDashboardTodos 用 !!x?.partial、(r as any).nextCursor 直读，键被云端改名时
    // 读到 undefined 仍是「不 partial / 没下一页」，上面的映射断言照样绿；这里按键名锁，改名必红。
    for (const c of ['orderCounts', 'refundCounts']) expect(S(c), c).toHaveProperty('partial', false)
    for (const c of ['listOrders', 'listOrders:payment_exception', 'listRefunds', 'listRefunds:refunded']) {
      expect(S(c), c).toHaveProperty('nextCursor')
      expect(S(c), c).toHaveProperty('hasMore', false)
    }
  })

  it('库存行：stock/threshold/updatedAt 取对字段，未触上限不标注', () => {
    const inv = S('listInventory')
    expect(mapStock(inv.list, inv.truncated)).toEqual({
      rows: [{ key: 'p1__', productId: 'p1', spec: '', stock: 3, threshold: 2, updatedAt: inv.list[0].updatedAt }],
      truncNote: '',
    })
  })
})

describe('对账映射（getReconciliation / getBillMatch 真实形状）', () => {
  it('内部对账：累计/区间/每日金额按元显示（收入含支付异常单实收 100 元）；金额不符单进异常明细', () => {
    const vm = mapRecon(S('getReconciliation'))!
    expect(vm.cumulative).toEqual([
      { label: '累计收入', value: '¥694.00' },
      { label: '累计退款', value: '¥198.00' },
      { label: '净额', value: '¥496.00' },
    ])
    expect(vm.summary).toEqual({ income: '¥694.00', refund: '¥198.00', net: '¥496.00', orders: 4, refunds: 1 })
    expect(vm.daily).toEqual([{ day: '2026-07-01', income: '¥694.00', refund: '¥198.00', net: '¥496.00', orders: 4, refunds: 1 }])
    expect(vm.range).toEqual({ from: '2026-07-01', to: '2026-07-01' })
    expect(vm.exceptions).toEqual([{ label: '金额不符单（先核对流水；支付异常走退款处理）', ids: [C] }])
    expect(vm.partial).toBe(false)
    expect(vm.approxNote).toBe('')
  })

  it('逐笔对账：四类计数、三类明细金额按元显示（金额不符取 ourAmount/wxAmount）', () => {
    const vm = mapBillMatch(S('getBillMatch'))!
    expect(vm.summary.map((s) => [s.value, !!s.danger])).toEqual([
      [1, false],
      [1, true],
      [2, false],
      [1, true],
    ])
    expect(vm.wxOnly).toEqual([{ transactionId: 'wx-ghost', amount: '¥5.50', date: '2026-07-01' }])
    expect(vm.oursOnly).toEqual([
      { id: C, amount: '¥198.00' },
      { id: D, amount: '¥198.00' },
    ])
    expect(vm.amountMismatch).toEqual([{ id: B, ours: '¥198.00', wx: '¥190.00' }])
    expect(vm.approxNote).toBe('')
  })
})

// 订单与钱组映射（守卫 rw-admin-money-ui-golden）：看板近似诚实标注/警报有则必显无则不吓人/
// 订单行金额不符禁发入口收窄/售后行只待审核可裁决/脏档安全（与 mp 同口径）。
import { describe, it, expect } from 'vitest'
import { mapDashboard, mapOrderRows, mapRefundRows, maskPhone, refundVerdict } from '../src/lib/mapMoney'

describe('看板映射', () => {
  it('大白话：成交额标「精确/近似」如实；异常有则必显（含单号）、无则一条不渲染；坏响应回 null 不渲染假看板', () => {
    const vm = mapDashboard({
      ok: true,
      stats: { users: 3, orders: 250, gmv: 258.5, codesTotal: 30, codesActivated: 5, learners: 2 },
      approx: { gmv: false, hot: true },
      funnel: { ordered: 250, paid: 200, activated: 5 },
      txAlerts: { feeMismatch: ['o-bad'], refundMismatch: [], stuckRefunds: [] },
      hot: [{ segId: 's1', name: '第1节·起头', count: 40 }],
      stuck: [{ segId: 's9', name: '第9节·收针', count: 12 }],
      recentActivity: [
        { type: 'order', at: 200, text: '新订单 o1 · ￥2.00' },
        { type: 'refund', at: 100, text: '退款申请 a1' },
        { type: 'x', at: 50, text: '' },
      ],
    })!
    expect(vm.cards.find((c) => c.label.includes('成交额'))).toMatchObject({ value: '¥258.50', note: '精确' })
    expect(vm.alerts).toEqual([{ label: '金额不符单', ids: ['o-bad'] }]) // 空类不渲染
    // B5：热点/卡点段位后端仍返回·换皮误删——结构化透传 + 抽样近似诚实标注
    expect(vm.hot).toEqual([{ name: '第1节·起头', count: 40 }])
    expect(vm.stuck).toEqual([{ name: '第9节·收针', count: 12 }])
    expect(vm.approxSeg).toBe(true)
    // 最近动态四类事件流（非纯订单列表）：空 text 剔除
    expect(vm.recent).toEqual([
      { type: 'order', at: 200, text: '新订单 o1 · ￥2.00' },
      { type: 'refund', at: 100, text: '退款申请 a1' },
    ])
    const clean = mapDashboard({ ok: true, stats: { users: 0 }, txAlerts: {} })!
    expect(clean.alerts).toEqual([]) // 无异常零警报
    expect(clean.hot).toEqual([]) // 无源空数组·不编数
    expect(clean.recent).toEqual([])
    expect(mapDashboard({ ok: false, error: 'X' })).toBeNull()
    expect(mapDashboard(null)).toBeNull()
  })
})

describe('订单行映射（发货入口收窄）', () => {
  it('大白话：只有「已付且金额相符」的单能点发货；金额不符标红禁发；发货后带运单号；脏档剔除', () => {
    const rows = mapOrderRows([
      { id: 'o1', status: 'paid', amount: 2, items: [{ name: '小熊', qty: 1 }], address: { name: '赵', phone: '186', region: '贵州', detail: 'x' }, createdAt: 1783046400000 },
      { id: 'o2', status: 'paid', feeMismatch: true, amount: 1, items: [] },
      { id: 'o3', status: 'shipped', amount: 3, items: [{ name: 'a', qty: 2 }, { name: 'b', qty: 1 }, { name: 'c', qty: 1 }], shipping: { trackingNo: 'SF123' } },
      { status: 'paid' },
      null,
    ])
    expect(rows).toHaveLength(3) // 脏档剔除
    expect(rows[0]).toMatchObject({ canShip: true, amountLabel: '¥2.00', count: 1 })
    expect(rows[0].address).toContain('贵州')
    expect(rows[1]).toMatchObject({ canShip: false, feeMismatch: true }) // 金额不符禁发
    expect(rows[2]).toMatchObject({ canShip: false, trackingNo: 'SF123' }) // 已发货不再发
    expect(rows[2].summary).toContain('等 3 件商品')
    expect(mapOrderRows('garbage')).toEqual([])
  })
})

describe('手机号掩码（PII·还原批 Orders）', () => {
  it('大白话：11 位号掩中间四位，短号/空原样不假掩', () => {
    expect(maskPhone('13812345678')).toBe('138****5678')
    expect(maskPhone('123')).toBe('123')
    expect(maskPhone('')).toBe('')
  })
})

describe('订单行映射·详情抽屉数据链 + 列表掩码（还原批 Orders）', () => {
  it('大白话：列表 address 掩码手机号不泄全号；抽屉字段带完整号+逐商品+交易号+微信合规三态+时间线时间戳；shipped 可改单号', () => {
    const rows = mapOrderRows([
      {
        id: 'o1',
        status: 'shipped',
        amount: 12.5,
        items: [{ productId: 'p1', name: '小熊', spec: '基础', qty: 2 }],
        address: { name: '赵四', phone: '13812345678', region: '贵州省', detail: '某路1号' },
        createdAt: 1783046400000,
        paidAt: 1783046460000,
        shippedAt: 1783046520000,
        transactionId: '4200TX',
        shipping: { company: '顺丰速运', trackingNo: 'SF9' },
        wxShipUploaded: false,
      },
    ])
    const r = rows[0]
    expect(r.address).toContain('138****5678') // 列表掩码
    expect(r.address).not.toContain('13812345678') // 绝不泄全号（PII）
    expect(r.addrPhone).toBe('13812345678') // 抽屉用完整号（操作员联系买家）
    expect(r.addrName).toBe('赵四')
    expect(r.items).toEqual([{ productId: 'p1', name: '小熊', spec: '基础', qty: 2 }])
    expect(r.transactionId).toBe('4200TX')
    expect(r.wxShipUploaded).toBe(false) // 三态：已知上传失败
    expect(r.company).toBe('顺丰速运')
    expect(r.canModify).toBe(true) // shipped 可改单号
    expect({ c: r.createdAtMs, p: r.paidAtMs, s: r.shippedAtMs }).toEqual({
      c: 1783046400000,
      p: 1783046460000,
      s: 1783046520000,
    })
  })
  it('大白话：微信合规未知＝null 不谎报未上传；未发货 canModify=false', () => {
    const [r] = mapOrderRows([{ id: 'o2', status: 'paid', amount: 1, items: [], address: { phone: '186' } }])
    expect(r.wxShipUploaded).toBeNull() // 未知不是 false
    expect(r.canModify).toBe(false)
    expect(r.address).toBe('186') // 短号不假掩
  })
})

describe('售后行映射（裁决入口收窄）', () => {
  it('大白话：只有待审核能同意/拒绝；金额恒两位；退什么带规格件数；脏档剔除', () => {
    const rows = mapRefundRows([
      { _id: 'a1', orderId: 'o1', status: 'applied', name: '小熊', spec: 'sku测试文案', qty: 1, refundAmount: 2, reason: '测试', appliedAt: 1783046400000 },
      { _id: 'a2', orderId: 'o2', status: 'refunded', name: 'x', qty: 1, refundAmount: 10, refundedAt: 1783046460000 },
      { _id: 'a3', orderId: 'o3', status: 'rejected', name: 'y', qty: 1, refundAmount: 5, rejectReason: '激活卡已拆用' },
      { orderId: 'o4' },
    ])
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({ canDecide: true, refundAmountLabel: '¥2.00' })
    expect(rows[0].what).toBe('小熊（sku测试文案） ×1')
    expect(rows[1].canDecide).toBe(false) // 已退款不可再裁决
    expect(rows[1].refundedAtLabel).not.toBe('') // 已退款结果区：到账时间
    expect(rows[2].rejectReason).toBe('激活卡已拆用') // 已拒绝结果区：原因
    expect(rows[0].refundedAtLabel).toBe('') // 未退款无到账时间·不谎报
  })
})

describe('退款判据文案（绑本单订单行·非课程级·根因#8 判据不失真·P2 修）', () => {
  it('大白话：本单此行可退→判放行（即便买家这门课已进过·进课撤的是别单/别码）；本单此行已撤→判会拦', () => {
    // P2 核心：买家经别单/别码进过这门课（entered:true），但本单此行仍可退——绝不显"会拦"
    const ok = refundVerdict({ lineRefundable: true, entered: true, refundableQty: 1 })
    expect(ok.tone).toBe('ok')
    expect(ok.title).toContain('可退')
    expect(ok.sub).not.toContain('ENTERED_NOT_REFUNDABLE') // 可退单不吓唬"会拦"
    // 未进课也可退
    expect(refundVerdict({ lineRefundable: true, entered: false, refundableQty: 1 }).tone).toBe('ok')
    // 本单此行被撤退货权（进课）→ 会拦
    const lost = refundVerdict({ lineRefundable: false, entered: true, refundableQty: 0 })
    expect(lost.tone).toBe('lost')
    expect(lost.sub).toContain('ENTERED_NOT_REFUNDABLE')
  })
})

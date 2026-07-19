// 订单与钱组映射（守卫 rw-admin-money-ui-golden）：看板近似诚实标注/警报有则必显无则不吓人/
// 订单行金额不符禁发入口收窄/售后行只待审核可裁决/脏档安全（与 mp 同口径）。
import { describe, it, expect } from 'vitest'
import { mapDashboard, mapOrderRows, mapRefundRows, maskPhone, refundVerdict, deriveDashboardTodos, canOverrideRefund, mapOverrideOrder } from '../src/lib/mapMoney'
import ordersSrc from '../src/pages/Orders.vue?raw'
import refundsSrc from '../src/pages/Refunds.vue?raw'
import dashboardSrc from '../src/pages/Dashboard.vue?raw'

describe('deriveDashboardTodos（待处理计数：加载失败别伪装成 0/全清·病根#14）', () => {
  it('大白话：某路计数加载失败时 partial=true——上层据此不把「加载失败」显示成绿色「今日无待处理」', () => {
    const t = deriveDashboardTodos({
      orderCounts: { ok: false }, // 待发货计数加载失败
      refundCounts: { ok: true, counts: { applied: 0 } },
      inventory: { ok: true, list: [] },
      drafts: { ok: true, rows: [] },
      low: 10,
    })
    expect(t.partial).toBe(true) // 有失败——不可信·上层不显「无待办 ✓」
    expect(t.ship).toBe(0) // 失败路暂显 0，但 partial 已标记：0 是「不知道」不是「真没有」
  })

  it('大白话：四路全 ok 且真没待办时 partial=false、各计数为云端真值', () => {
    const t = deriveDashboardTodos({
      orderCounts: { ok: true, counts: { paid: 3 } },
      refundCounts: { ok: true, counts: { applied: 1 } },
      inventory: { ok: true, list: [{ stock: 2 }, { stock: 50 }] },
      drafts: { ok: true, rows: [{ state: 'preparing' }, { state: 'listed' }] },
      low: 10,
    })
    expect(t.partial).toBe(false)
    expect(t).toMatchObject({ ship: 3, refund: 1, lowStock: 1, prep: 1 }) // 库存 2≤10 计低库存·preparing 计上新未完成
  })

  it('大白话：orderCounts/refundCounts 本身 ok:true 但服务端内部某路 count 失败时也带了 partial:true——不能因为整体 ok 就当真值信（P1·item7）', () => {
    const t1 = deriveDashboardTodos({
      orderCounts: { ok: true, counts: { paid: 3 }, partial: true }, // 服务端：部分状态 count() 失败·数字不可信
      refundCounts: { ok: true, counts: { applied: 1 } },
      inventory: { ok: true, list: [] },
      drafts: { ok: true, rows: [] },
      low: 10,
    })
    expect(t1.partial).toBe(true) // 不因四路整体 .ok 都为 true 就误判为「真没待办」
    const t2 = deriveDashboardTodos({
      orderCounts: { ok: true, counts: { paid: 3 } },
      refundCounts: { ok: true, counts: { applied: 1 }, partial: true }, // refundCounts 侧同理
      inventory: { ok: true, list: [] },
      drafts: { ok: true, rows: [] },
      low: 10,
    })
    expect(t2.partial).toBe(true)
  })
})

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
    // 漏斗逐环转化率（换皮丢·只剩绝对值看不出支付率/激活率）
    expect(vm.funnel.find((f) => f.label === '支付')!.sub).toBe('较上环 80%') // 200/250
    expect(vm.funnel.find((f) => f.label === '激活')!.sub).toContain('%')
    expect(vm.funnel.find((f) => f.label === '下单')!.sub).toBe('') // 首环无上环
    // 激活率进度条（换皮把进度条+百分比退成纯「已激活/总」文本·丢了激活率）
    const codes = vm.cards.find((c) => c.label.includes('激活码'))!
    expect(codes.pct).toBe(17) // 5/30≈17%
    expect(codes.sub).toContain('激活率')
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
    // refund_required（PAID_BUT_OOS 死信·待人工退款）标「待退款」·非「退款处理中」（换皮误标·与退款 approved 语义撞车）
    const [rq] = mapOrderRows([{ id: 'oq', status: 'refund_required', amount: 2, items: [] }])
    expect(rq.statusLabel).toBe('待退款')
    expect(rq.canShip).toBe(false)
    expect(mapOrderRows('garbage')).toEqual([])
  })

  // P0 修复（退款↔履约状态同步·根因：approveRefund/overrideRefund 只改 afterSales 不碰 orders，
  // 旧版 shipOne 唯一放行条件是 paid+非金额异常，完全不查退款态——已批准退款的单能被照发＝钱货两空）：
  // 后端 listOrders join afterSales 后端把 refundHold 标记贴在订单行上，前端入口收窄同步挡（真正拦截闸在 shipOne）。
  it('大白话：已有行退款 approved/refunded（refundHold）即使 paid 且金额相符也禁发货', () => {
    const [r] = mapOrderRows([{ id: 'or', status: 'paid', amount: 2, items: [], refundHold: true }])
    expect(r.canShip).toBe(false)
    expect(r.refundHold).toBe(true)
    const [ok] = mapOrderRows([{ id: 'ok', status: 'paid', amount: 2, items: [], refundHold: false }])
    expect(ok.canShip).toBe(true)
    expect(ok.refundHold).toBe(false)
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
      { _id: 'a1', orderId: 'o1', status: 'applied', name: '小熊', spec: 'sku测试文案', qty: 1, refundAmount: 2, reason: '测试', appliedAt: 1783046400000, buyerName: '赵四', buyerPhone: '13812345678' },
      { _id: 'a2', orderId: 'o2', status: 'refunded', name: 'x', qty: 1, refundAmount: 10, refundedAt: 1783046460000 },
      { _id: 'a3', orderId: 'o3', status: 'rejected', name: 'y', qty: 1, refundAmount: 5, rejectReason: '激活卡已拆用' },
      { orderId: 'o4' },
    ])
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({ canDecide: true, refundAmountLabel: '¥2.00' })
    expect(rows[0].what).toBe('小熊（sku测试文案） ×1')
    // 买家身份（换皮丢·审退款只见订单号无法识别申请人/联系寄回）：抽屉用全号、列表用掩码（PII·根因#3）
    expect(rows[0].buyerName).toBe('赵四')
    expect(rows[0].buyerPhone).toBe('13812345678') // 抽屉全号
    expect(rows[0].buyerMasked).toBe('138****5678') // 列表掩码
    expect(rows[1].buyerName).toBe('') // 缺字段安全空
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

describe('越规退款入口（决策§26·批 B8·钱链后端零改动）', () => {
  it('大白话：提交按钮门控——找到订单+选中行+原因非空(trim)+已勾知晓+非在途，四项齐才放行；差一项都不放行', () => {
    const base = { orderFound: true, lineId: 'l1', reason: '客服特批', ack: true, busy: false }
    expect(canOverrideRefund(base)).toBe(true)
    expect(canOverrideRefund({ ...base, orderFound: false })).toBe(false) // 未查到订单
    expect(canOverrideRefund({ ...base, lineId: '' })).toBe(false) // 未选行
    expect(canOverrideRefund({ ...base, reason: '' })).toBe(false) // 原因空
    expect(canOverrideRefund({ ...base, reason: '   ' })).toBe(false) // 原因全空白（trim 后判空·不许纯空格绕过必填）
    expect(canOverrideRefund({ ...base, ack: false })).toBe(false) // 未勾知晓
    expect(canOverrideRefund({ ...base, busy: true })).toBe(false) // 在途禁重复提交
  })

  it('大白话：mapOverrideOrder 按订单号从 listOrders 回包挑目标单+映射只读展示字段——不发明金额、行标签只是辨认用（非退款额）', () => {
    const list = [
      {
        _id: 'o1',
        status: 'paid',
        amount: 178,
        goods: 198,
        address: { name: '张三', phone: '13800000000' },
        items: [
          { lineId: 'p1__基础款', productId: 'p1', name: '小鸭', spec: '基础款', qty: 1, price: 198 },
          { productId: 'p2', name: '毛线', qty: 2, price: 20 }, // 旧单无 lineId 回退 productId
        ],
      },
    ]
    const vm = mapOverrideOrder(list, 'o1')!
    expect(vm.id).toBe('o1')
    expect(vm.buyerName).toBe('张三')
    expect(vm.amountLabel).toBe('¥178.00')
    expect(vm.goodsLabel).toBe('¥198.00')
    expect(vm.lines).toEqual([
      { lineId: 'p1__基础款', label: '小鸭（基础款） ×1 · ¥198.00' },
      { lineId: 'p2', label: '毛线 ×2 · ¥20.00' },
    ])
    // 未命中订单号 / 坏响应 → null（不渲染假数据）
    expect(mapOverrideOrder(list, 'o-nope')).toBeNull()
    expect(mapOverrideOrder('garbage', 'o1')).toBeNull()
    expect(mapOverrideOrder(null, 'o1')).toBeNull()
  })

  // 批K K3（可达性回归）：refund_required 死信单是越规退款的**唯一**在库出口，前端不得对它做任何状态白名单——
  // 商品行照渲染、状态显示「待退款」、门控只看「选了行+填了原因+勾了确认」。防后人顺手加 status 过滤把出口堵死。
  it('大白话：refund_required 死信单在越规退款面板照常可选可提交（状态显示「待退款」·无状态白名单挡路）', () => {
    const vm = mapOverrideOrder(
      [{ _id: 'oD', status: 'refund_required', amount: 178, goods: 198, address: { name: '李四', phone: '13900000000' }, items: [{ lineId: 'p1__红', productId: 'p1', name: '鸭', spec: '红', qty: 2, price: 198 }] }],
      'oD',
    )!
    expect(vm.statusLabel).toBe('待退款')
    expect(vm.lines).toEqual([{ lineId: 'p1__红', label: '鸭（红） ×2 · ¥198.00' }])
    expect(canOverrideRefund({ orderFound: true, lineId: vm.lines[0].lineId, reason: '缺货无法履约', ack: true, busy: false })).toBe(true)
  })
})

// Orders.vue 抽屉商品行 :key 行身份（深审20260712·P3 撞键·取真源法）：旧 key 裸用 productId，
// 同一 productId 多规格（多 lineId）同单必撞 Vue key；行身份契约是 lineId=productId__spec
// （cloud app/actions/orders.ts lineIdOf 单源），VM 未透传 lineId 故模板按契约就地重建。
// Refunds.vue openDecide 判据加载失败不得渲绿（深审20260712·P2·根因#14/#8·取真源法同上）：getRefundDetail
// 网络失败时 r.ok=false、无 activation/lineRefundable 字段，旧代码不检查 r.ok 直接组 verdict →
// activated:false + lineRefundable 默认 true 渲成确定的绿色「激活码未使用·可退」误导审核员同意退款。
describe('Refunds.vue openDecide 判据失败分支（失败不渲绿判据·decideErr 红条亮）', () => {
  const body = refundsSrc.slice(refundsSrc.indexOf('async function openDecide'), refundsSrc.indexOf('function closeDecide'))
  it('大白话：r.ok=false → verdict 置 null（判据区不渲绿）+ decideErr 给原因 + return——绝不落入组判据；成功组装必在失败检查之后', () => {
    expect(body).toMatch(/if\s*\(!r\.ok\)\s*\{[\s\S]*?verdict\.value = null[\s\S]*?decideErr\.value = '判据加载失败：'[\s\S]*?return[\s\S]*?\}/)
    expect(body.search(/if\s*\(!r\.ok\)/)).toBeGreaterThan(-1)
    expect(body.search(/if\s*\(!r\.ok\)/)).toBeLessThan(body.indexOf('loading: false')) // 组 verdict（loading:false）只在 ok 检查通过后可达
    expect(body.indexOf('loading: false')).toBeGreaterThan(-1)
  })
  it('大白话：判据失败时模板给「重新加载判据」重试入口（verdict=null 才显）', () => {
    expect(refundsSrc).toMatch(/v-else-if="!verdict"[^>]*@click="openDecide\(decideRow\)"/)
    expect(refundsSrc).toContain('重新加载判据')
  })
})

describe('Orders.vue 抽屉商品行 :key 用行身份 productId__spec', () => {
  it('大白话：key 带 spec（=后端 lineId 契约）——同品多规格同单不撞键；旧裸 productId 写法不再存在', () => {
    expect(ordersSrc).toMatch(/v-for="it in drawer\.row\.items" :key="\(it\.productId \|\| it\.name\) \+ '__' \+ it\.spec"/)
    expect(ordersSrc).not.toMatch(/:key="it\.productId \|\| it\.name"/)
  })
})

// Refunds.vue 深链预填（债目·全局清零bug战役残余 2026-07-13）：Dashboard 退款类告警「去处理」跳
// /refunds 只做到「跳对页面」，本页原无 route.query 读取能力接不住具体记录——补 onMounted 读
// route.query.q 预填搜索框并自动检索一次（同 Conversations.vue/Batches.vue 既有深链范式）。
describe('Refunds.vue 深链预填：route.query.q 预填搜索框 + 自动检索', () => {
  it('大白话：search 初值读 route.query.q；挂载时有值走 doSearch 自动检索、无值走普通 reload', () => {
    expect(refundsSrc).toMatch(/const search = ref\(String\(route\.query\.q \|\| ''\)\)/)
    expect(refundsSrc).toMatch(/if \(search\.value\) void doSearch\(\)/)
    expect(refundsSrc).toMatch(/else void reload\(\)/)
  })
})

// Dashboard.vue 告警「去处理」深链带 q（债目同上）：恰好 1 个 id 才有「跳到具体记录」的唯一目标语义，
// 多 id/无 id 仍跳纯列表；afterSales 复合 id（`orderId__lineId[__ovrN]`）反解取 split('__')[0]；
// feeMismatch 走 /orders，本次深链范围只含 /refunds 一侧。
describe('Dashboard.vue 告警「去处理」深链带 q：唯一 id 才带参，多 id/无 id/金额不符单不带', () => {
  const body = dashboardSrc.slice(dashboardSrc.indexOf('function alertQuery'), dashboardSrc.indexOf('const TODOS'))
  it('大白话：feeMismatch 或非唯一 id 回空 query；恰好 1 个 id 且非 feeMismatch 才反解出 q', () => {
    expect(body).toMatch(/if \(isFeeMismatch\(a\.label\) \|\| a\.ids\.length !== 1\) return \{\}/)
    expect(body).toMatch(/return \{ q: raw\.includes\('__'\) \? raw\.split\('__'\)\[0\] : raw \}/)
  })
  it('大白话：模板「去处理」按钮把 alertPath/alertQuery 一起塞进 router.push 的 path/query', () => {
    expect(dashboardSrc).toMatch(/router\.push\(\{ path: alertPath\(a\.label\), query: alertQuery\(a\) \}\)/)
  })
})

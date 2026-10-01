// 黄金 frontend-store §七（脏单归一防白屏/渲染访问点纵深防御）+ §四（金额两位小数/
// 时间格式化非法回空）。
import { describe, it, expect } from 'vitest'
import { mapOrder, mapOrders, itemsOf, countOf, statusLabel, dateTime, amountTitle, __amountTitleSets, orderSteps, countBadge, PAY_WINDOW_MS, cardLabel, listRight, detailSub, orderLed } from '../lib/mapOrders'
import { PAY_WINDOW_MS as SHARED_PAY_WINDOW_MS } from '../../shared/src/limits'
import { ORDER_STATUS } from '../../shared/src/order'

const GOOD = {
  _id: '2026070412001234',
  id: '2026070412001234',
  status: 'paid',
  items: [
    { productId: 'p1', lineId: 'p1__', name: '小鸭', spec: '', price: 128, qty: 2, refundable: true, cover: 'cloud://x/p1.jpg' },
    { productId: 'p2', lineId: 'p2__白', name: '小熊', spec: '白', price: 22.5, qty: 1, refundable: false },
  ],
  goods: 278.5,
  coupon: 20,
  ship: 0,
  amount: 258.5,
  address: { name: '张三', phone: '138', region: '广东', detail: '南山' },
  createdAt: 1783046400000,
  trackingNo: '',
}

describe('订单映射（黄金 §七：脏单归一·纵深防御）', () => {
  it('大白话：正常单全字段映射——状态中文、金额恒两位小数、件数合计、时间可读', () => {
    const vm = mapOrder(GOOD)!
    expect(vm.statusLabel).toBe('待发货')
    expect(vm.amountLabel).toBe('¥258.50') // 恒两位小数
    expect(vm.items[1].priceLabel).toBe('¥22.50')
    expect(vm.count).toBe(3)
    expect(vm.couponLabel).toBe('') // 历史单 coupon=20 也不展示优惠券标签；实付仍用库内 amount
    expect(vm.shipLabel).toBe('包邮')
    expect(vm.createdAtLabel).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
    expect(JSON.stringify(vm)).not.toContain('undefined')
  })

  it('大白话：脏单不白屏——缺条目/条目 null/非数组一律归一空数组、件数 0、绝不抛错；裸脏档整行剔除', () => {
    for (const dirty of [{ id: 'o1' }, { id: 'o2', items: null }, { id: 'o3', items: '坏' }, { id: 'o5', items: 42 }, { id: 'o6', items: { not: 'array' } }, { id: 'o4', items: [null, {}, { name: '半条', qty: -1 }] }]) {
      expect(() => itemsOf(dirty)).not.toThrow()
      expect(countOf(dirty)).toBe(0)
      const vm = mapOrder(dirty)!
      expect(vm.items.filter((l) => l.qty > 0)).toEqual([])
    }
    expect(itemsOf(null)).toEqual([]) // 裸 null 也不抛
    expect(countOf(undefined)).toBe(0)
    const list = mapOrders([GOOD, { status: 'paid' }, null, '垃圾'])
    expect(list).toHaveLength(1) // 无 id 裸脏档剔除·不进列表
  })

  it('大白话：未知状态回原串不冒充；非法时间戳回空串', () => {
    // 待退款（PAID_BUT_OOS 死信·已付但缺货·待人工退款）·非「退款处理中」——与 admin 同口径
    // （admin/src/lib/format.ts）；客户没申请过退款、商家也没在自动处理，别编造行为描述。
    expect(statusLabel('refund_required')).toBe('待退款')
    expect(statusLabel('weird_status')).toBe('weird_status')
    expect(dateTime('abc')).toBe('')
    expect(dateTime(-5)).toBe('')
  })
})

// C 类竖切补全（2026-07-07）：订单行封面图（下单快照）+ 物流运单（取自 shipping 子对象·别再读顶层）。
const SHIPPED = {
  id: 'oShip',
  status: 'shipped',
  items: [{ productId: 'p1', lineId: 'p1__', name: '小鸭', spec: '', price: 128, qty: 1, refundable: true }],
  amount: 128,
  createdAt: 1783046400000,
  shipping: { company: '顺丰', trackingNo: 'SF7788' }, // admin shipOne 写在 o.shipping 子对象
  shippedAt: 1783050000000,
}

describe('订单行封面 + 物流运单（C 类竖切·守卫别再退回顶层 trackingNo）', () => {
  it('大白话：商品行携带下单时快照的封面（cloud:// fileID）；无封面的行落空串不渲染裂图', () => {
    const vm = mapOrder(GOOD)!
    expect(vm.items[0].cover).toBe('cloud://x/p1.jpg')
    expect(vm.items[1].cover).toBe('') // p2 无封面（旧单/搭配购同）→ 空串不留 undefined
    expect(JSON.stringify(vm)).not.toContain('undefined')
  })
  it('大白话：运单号/物流公司取自 shipping 子对象（admin 发货写 o.shipping·非顶层 o.trackingNo）', () => {
    const vm = mapOrder(SHIPPED)!
    expect(vm.trackingNo).toBe('SF7788')
    expect(vm.shipCompany).toBe('顺丰')
    expect(vm.shippedAtLabel).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  })
  it('大白话：无 shipping 的旧脏单不抛·运单空·公司空·发货时间空（向后兼容）', () => {
    const vm = mapOrder(GOOD)! // GOOD 无 shipping 子对象
    expect(vm.trackingNo).toBe('')
    expect(vm.shipCompany).toBe('')
    expect(vm.shippedAtLabel).toBe('')
    expect(() => mapOrder({ id: 'x', shipping: '坏' })).not.toThrow() // shipping 非对象也不抛
  })
})

// 2026-07-25 全量页面体检批 P1：订单详情/列表曾对**全部**状态硬编码「实付款」——已关闭订单（从未付过钱，
// 状态机 closed 只从 pending 转来）同屏两处写「实付款 ¥778.00」，顾客会以为钱被扣了。
describe('金额行标题·顾客视角「付过没有」（体检批 P1·钱链措辞）', () => {
  it('大白话：已关闭的订单从没付过钱，金额行绝不能写「实付款」', () => {
    expect(amountTitle('closed')).toBe('订单金额')
    expect(mapOrder({ ...GOOD, status: 'closed' })!.amountTitle).toBe('订单金额')
    expect(mapOrder({ ...GOOD, status: 'closed' })!.amountTitle).not.toBe('实付款')
  })
  it('大白话：待支付的单同理——钱还没付，写「实付款」是假话', () => {
    expect(amountTitle('pending')).toBe('订单金额')
    expect(mapOrder({ ...GOOD, status: 'pending' })!.amountTitle).toBe('订单金额')
  })
  it('大白话：付过钱的（待发货/待收货/已完成）写「实付款」；待退款也算付过（钱已收待人工退）', () => {
    for (const s of ['paid', 'shipped', 'done', 'refund_required', 'payment_exception']) {
      expect(amountTitle(s)).toBe('实付款')
      expect(mapOrder({ ...GOOD, status: s })!.amountTitle).toBe('实付款')
    }
  })
  it('大白话：支付异常单「实付款」展示实际到账 paidFee，不是订单标价（多代理审核 codex#5·对账/退款沟通依据）', () => {
    const r = mapOrder({ ...GOOD, status: 'payment_exception', paidFee: 17700 })!
    expect(r.amountLabel).toBe('¥177.00')
    // 实付额脏/缺回退订单金额（不造假数）
    expect(mapOrder({ ...GOOD, status: 'payment_exception', paidFee: null })!.amountLabel).toBe('¥258.50')
  })
  it('大白话：没见过的状态按「没付过」兜底，不冒充已付（fail-safe）', () => {
    expect(amountTitle('weird_new_state')).toBe('订单金额')
    expect(amountTitle('')).toBe('订单金额')
    expect(amountTitle(undefined)).toBe('订单金额')
  })
  // 穷举性（mp 进不了 @ldrw/shared 故手落副本·同 STATUS_LABELS 范式）：不比对「另一份名单」，
  // 而是钉「每个订单状态都被显式归过类」——新增状态若两边都忘了加，这里当场红，
  // 不会被 amountTitle 的未知态兜底默默吞掉（兜底是 fail-safe，不是免检牌）。
  it('大白话：状态机里每一个订单状态，都必须明确归进「付过钱」或「没付过」，一个都不能漏', () => {
    const all = Object.values(ORDER_STATUS).sort()
    const { PAID_LOOK, UNPAID_LOOK } = __amountTitleSets
    expect([...PAID_LOOK, ...UNPAID_LOOK].sort()).toEqual(all)
    expect(PAID_LOOK.filter((s) => UNPAID_LOOK.includes(s))).toEqual([]) // 两类互斥
    for (const s of PAID_LOOK) expect(amountTitle(s)).toBe('实付款')
    for (const s of UNPAID_LOOK) expect(amountTitle(s)).toBe('订单金额')
  })
})

describe('「我」页订单格数字 countBadge（v5 D1）', () => {
  it('大白话：云端精确数在上限内给实数；超过上限给「20+」；取数失败（null/非数字/负数）给空串（不显示数字，不瞎报 0）', () => {
    expect(countBadge(3, 20)).toBe('3')
    expect(countBadge(0, 20)).toBe('0')
    expect(countBadge(20, 20)).toBe('20')
    expect(countBadge(21, 20)).toBe('20+')
    expect(countBadge(null, 20)).toBe('')
    expect(countBadge(undefined, 20)).toBe('')
    expect(countBadge('3', 20)).toBe('')
    expect(countBadge(-1, 20)).toBe('')
  })
})

describe('订单进度四步（v5 订单详情：下单 / 付款 / 发货 / 收货·照设计稿亮「已走到的最后一步」）', () => {
  const view = (s: string) => orderSteps(s).map((x) => x.state).join(',')
  it('大白话：待支付＝「下单」是当前紫步；待发货＝「付款」；待收货＝「发货」；完成四步全黑', () => {
    expect(view('pending')).toBe('cur,todo,todo,todo')
    expect(view('paid')).toBe('done,cur,todo,todo')
    expect(view('shipped')).toBe('done,done,cur,todo')
    expect(view('done')).toBe('done,done,done,done')
  })
  it('大白话：待退款/支付异常——钱付过，前两步实心黑点、不亮紫；已关闭只亮「下单」；不认识的状态同已关闭，不瞎亮', () => {
    expect(view('refund_required')).toBe('done,done,todo,todo')
    expect(view('payment_exception')).toBe('done,done,todo,todo')
    expect(view('closed')).toBe('done,todo,todo,todo')
    expect(view('whatever')).toBe('done,todo,todo,todo')
    expect(orderSteps('paid').map((x) => x.label)).toEqual(['下单', '付款', '发货', '收货'])
  })
})

describe('订单卡右上角 / 详情状态卡小字（v5 B1·B2）', () => {
  const T0 = 1783046400000
  const vmOf = (over: Record<string, unknown>) => mapOrder({ _id: 'o1', createdAt: T0, ...over })!
  it('大白话：支付窗口副本与 shared 同值（15 分钟）', () => {
    expect(PAY_WINDOW_MS).toBe(SHARED_PAY_WINDOW_MS)
  })
  it('大白话：待支付显示「mm:ss」倒计时（下单时间 + 15 分钟），过点不倒负、右侧改写「未按时支付」、详情「15 分钟内未支付，订单已关闭」（UI 审查 15 问 6a）', () => {
    expect(listRight(vmOf({ status: 'pending' }), T0 + 60_000)).toEqual({ cd: '14:00', text: '' })
    expect(listRight(vmOf({ status: 'pending' }), T0 + 14 * 60_000 + 55_500)).toEqual({ cd: '00:04', text: '' })
    expect(listRight(vmOf({ status: 'pending' }), T0 + 99 * 60_000)).toEqual({ cd: '', text: '未按时支付' })
    expect(detailSub(vmOf({ status: 'pending' }), T0 + 15 * 60_000)).toEqual({ text: '15 分钟内未支付，订单已关闭', tone: '' })
  })
  it('大白话：待发货「48 小时内发货」；待收货「承运方 · 派送中」（没填承运方只写派送中）；完成写「M月D日 签收」，旧单没完成时间退回下单时间；待退款「客服处理中」', () => {
    expect(listRight(vmOf({ status: 'paid' }), T0).text).toBe('48 小时内发货')
    expect(listRight(vmOf({ status: 'shipped', shipping: { company: '中通快递' } }), T0).text).toBe('中通快递 · 派送中')
    expect(listRight(vmOf({ status: 'shipped' }), T0).text).toBe('派送中')
    const done = vmOf({ status: 'done', doneAt: T0 + 3 * 86400_000 })
    expect(listRight(done, T0).text).toMatch(/^\d{1,2}月\d{1,2}日 签收$/)
    expect(done.doneDateLabel).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    const oldDone = vmOf({ status: 'done' })
    expect(listRight(oldDone, T0).text).toBe(oldDone.createdAtLabel)
    expect(listRight(vmOf({ status: 'refund_required' }), T0).text).toBe('客服处理中')
  })
  it('大白话：卡片状态名与筛选标签、详情完全同名（UI 审查 15 问 6a）；支付异常只叫「支付异常」', () => {
    expect(cardLabel('paid')).toBe('待发货')
    expect(cardLabel('payment_exception')).toBe('支付异常')
    expect(cardLabel('shipped')).toBe('待收货')
    expect(statusLabel('paid')).toBe('待发货')
  })
  it('大白话：状态灯——已完成/已关闭灰点无光晕、待支付/待退款黄、支付异常红、待发货/待收货墨点（UI 审查 15 问 6a）', () => {
    expect(orderLed('done')).toEqual({ tone: 'rgba(17,17,17,.28)', halo: 'none' })
    expect(orderLed('closed')).toEqual({ tone: 'rgba(17,17,17,.28)', halo: 'none' })
    expect(orderLed('refund_required').tone).toBe('var(--v5-warn)')
    expect(orderLed('pending').tone).toBe('var(--v5-warn)')
    expect(orderLed('payment_exception').tone).toBe('var(--v5-err)')
    expect(orderLed('paid').tone).toBe('var(--v5-ink)')
    expect(orderLed('shipped').tone).toBe('var(--v5-ink)')
  })
  it('大白话：详情说明句——只有待支付倒计时深黄，其余一律灰；完成「M月D日 已签收」；待退款/支付异常写原因不承诺时效（UI 审查 15 问 6a）', () => {
    expect(detailSub(vmOf({ status: 'pending' }), T0 + 60_000)).toEqual({ text: '14:00 后自动取消，请尽快支付', tone: 'warn' })
    expect(detailSub(vmOf({ status: 'pending' }), T0 + 14 * 60_000 + 30_000)).toEqual({ text: '00:30 后自动取消，请尽快支付', tone: 'warn' })
    const done = vmOf({ status: 'done', doneAt: T0 })
    expect(detailSub(done, T0)).toEqual({ text: expect.stringMatching(/^\d{1,2}月\d{1,2}日 已签收$/), tone: '' })
    expect(detailSub(vmOf({ status: 'done' }), T0).text).toBe('')
    expect(detailSub(vmOf({ status: 'paid' }), T0)).toEqual({ text: '商家会在 48 小时内发货', tone: '' })
    expect(detailSub(vmOf({ status: 'payment_exception' }), T0)).toEqual({ text: '到账金额与订单金额不一致，请联系客服处理', tone: '' })
    expect(detailSub(vmOf({ status: 'refund_required' }), T0)).toEqual({ text: '需人工退款，请联系客服处理', tone: '' })
  })
})

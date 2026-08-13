// 黄金 frontend-store §七（脏单归一防白屏/渲染访问点纵深防御）+ §四（金额两位小数/
// 时间格式化非法回空）（守卫 rw-mp-orders-golden）。
import { describe, it, expect } from 'vitest'
import { mapOrder, mapOrders, itemsOf, countOf, statusLabel, dateTime, amountTitle, __amountTitleSets } from '../lib/mapOrders'
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
    expect(vm.couponLabel).toBe('-¥20.00')
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

// 黄金 frontend-store §五（地址簿：空簿/唯一 id/默认唯一）+ 结算草稿语义（快照独立/直买不动车/
// 提交精确扣车）+ 金额分口径与云端 createOrder 同式（守卫 rw-mp-checkout-golden）。
import { describe, it, expect, beforeEach } from 'vitest'
import * as addr from '../lib/address'
import * as cart from '../lib/cart'
import * as checkout from '../lib/checkout'
import { COUPON } from '../lib/checkoutConst'

let storage: Record<string, unknown> = {}
;(globalThis as any).wx = {
  getStorageSync: (k: string) => storage[k],
  setStorageSync: (k: string, v: unknown) => {
    storage[k] = JSON.parse(JSON.stringify(v))
  },
}

const A1 = { name: '张三', phone: '13800000001', region: '广东 深圳 南山', detail: '科技园 1 栋 101' }

beforeEach(() => {
  storage = {}
  addr.__resetForTest()
  cart.__resetForTest()
  checkout.__resetForTest()
})

describe('地址簿（黄金 §五）', () => {
  it('大白话：生产初始空簿不内置样例（防误发货到假地址）；新增 id 不撞号——冷启动回灌后再加也不撞；默认唯一', () => {
    expect(addr.getList()).toEqual([]) // 空簿·无样例
    addr.saveAddress({ ...A1, isDefault: true })
    addr.saveAddress({ ...A1, name: '李四' })
    const [a, b] = addr.getList()
    expect(a.id).not.toBe(b.id)
    // 冷启动回灌后新增：id 基于现有最大+1·不与已存撞号（模块计数器归零那类坑）
    addr.__resetForTest()
    addr.saveAddress({ ...A1, name: '王五' })
    const ids = addr.getList().map((x) => x.id)
    expect(new Set(ids).size).toBe(3)
    // 默认唯一：改设李四默认 → 全簿只此一条默认
    const li = addr.getList().find((x) => x.name === '李四')!
    addr.setDefault(li.id)
    expect(addr.getList().filter((x) => x.isDefault)).toHaveLength(1)
    expect(addr.defaultAddress()!.name).toBe('李四')
    // 删默认 → 第一条补位默认（簿不失默认）
    addr.removeAddress(li.id)
    expect(addr.getList().filter((x) => x.isDefault)).toHaveLength(1)
    // 回灌清洗：残缺地址丢弃
    expect(addr.sanitizeAddresses({ list: [{ id: 1, name: 'x', phone: '1', region: 'r', detail: 'd' }, { id: 2, name: '缺电话', region: 'r', detail: 'd' }, null] })).toHaveLength(1)
  })
})

describe('结算草稿（快照语义·直买不动车·提交精确扣车）', () => {
  it('大白话：去结算=选中项快照，之后改购物车不影响草稿；立即购买单件成稿、购物车原样', () => {
    cart.add({ id: 'p1', name: '小鸭', price: 128 })
    cart.add({ id: 'p2', name: '小熊', price: 22 })
    cart.toggle('p2') // 只选 p1
    checkout.prepareFromCart()
    cart.setQty('p1', 9) // 快照后改车
    const draft = checkout.getDraft()
    expect(draft.items).toHaveLength(1)
    expect(draft.items[0].qty).toBe(1) // 快照独立·不随车动
    expect(draft.fromCart).toBe(true)
    checkout.prepareBuyNow({ id: 'p9', name: '直买鸭', price: 98 })
    expect(checkout.getDraft().items.map((l) => l.id)).toEqual(['p9'])
    expect(checkout.getDraft().fromCart).toBe(false)
    expect(cart.getItems()).toHaveLength(2) // 直买不动购物车
  })

  it('大白话：草稿行 lineId（wx:key 用·批5）随行透传——购物车来源同 cart.lineIdOf 口径，直买/搭配购各自合成不撞', () => {
    cart.add({ id: 'p1', name: '小鸭', price: 128 })
    cart.add({ id: 'p1', sku: '云朵白', name: '小鸭', price: 138 })
    checkout.prepareFromCart()
    const lineIds = checkout.getDraft().items.map((l) => l.lineId)
    expect(new Set(lineIds).size).toBe(2) // 同 id 异 sku 草稿行不撞 key
    expect(checkout.getDraft().items.find((l) => l.sku === '')!.lineId).toBe(cart.lineIdOf('p1', ''))
    expect(checkout.getDraft().items.find((l) => l.sku === '云朵白')!.lineId).toBe(cart.lineIdOf('p1', '云朵白'))
    checkout.prepareBuyNow({ id: 'p9', name: '直买鸭', price: 98 })
    expect(checkout.getDraft().items[0].lineId).toBe(cart.lineIdOf('p9', ''))
    checkout.toggleAddon('hook')
    expect(checkout.getDraft().items.find((l) => l.id === 'hook')!.lineId).toBe(cart.lineIdOf('hook', ''))
  })

  it('大白话：搭配购加/减幂等切换；金额=商品+运费−券且不为负（与云端同式·分整数）；提交成功只扣购物车来源行、搭配购不碰车', () => {
    cart.add({ id: 'p1', name: '小鸭', price: 128 })
    cart.setQty('p1', 3)
    checkout.prepareFromCart()
    checkout.toggleAddon('hook') // +39
    checkout.toggleAddon('hook') // 再点移除
    checkout.toggleAddon('hook') // 再加回
    checkout.toggleAddon('ghost') // 未知搭配购不理
    const s = checkout.summaryFen()
    expect(s.goodsFen).toBe(128 * 3 * 100 + 3900)
    expect(s.amountFen).toBe(s.goodsFen + s.shipFen - COUPON * 100)
    expect(Number.isInteger(s.amountFen)).toBe(true)
    // 低于券额不出负数（云端 Math.max(0,…) 同式）
    checkout.prepareBuyNow({ id: 'cheap', name: '便宜货', price: 5 })
    expect(checkout.summaryFen().amountFen).toBe(0)
    // 提交精确扣车：3 件 p1 的草稿提交 → 车里 p1 整行走（含搭配购行不反噬车）
    cart.__resetForTest()
    storage = {}
    cart.add({ id: 'p1', name: '小鸭', price: 128 })
    cart.setQty('p1', 3)
    cart.add({ id: 'p2', name: '小熊', price: 22 })
    cart.toggle('p2')
    checkout.prepareFromCart()
    checkout.toggleAddon('yarn')
    checkout.finishSubmitted()
    const rest = cart.getItems()
    expect(rest.map((i) => i.id)).toEqual(['p2']) // p1 全量买走移除·p2 未选中原样
    expect(checkout.getDraft().items).toEqual([]) // 草稿清空·不残留
  })
})

describe('建单成功页金额取权威回包值（bug sweep R1 #1）', () => {
  it('大白话：回包 order.amount（元）才是权威值——换算分与前端自算值不一致时以回包为准', () => {
    expect(checkout.resolveOrderAmountFen({ amount: 198 }, 999)).toBe(19800)
    expect(checkout.resolveOrderAmountFen({ amount: 0 }, 999)).toBe(0) // 0 元单：合法值不误判缺失
  })
  it('大白话：回包缺 amount / 非法数字才回退调用方传入的前端自算值（防御分支）', () => {
    expect(checkout.resolveOrderAmountFen({}, 555)).toBe(555)
    expect(checkout.resolveOrderAmountFen(null, 555)).toBe(555)
    expect(checkout.resolveOrderAmountFen({ amount: 'nan' }, 555)).toBe(555)
  })
})

describe('建单失败错误码 → 人话文案（bug sweep R1 #2·不吞成通用失败）', () => {
  it('大白话：COUPON_EXCEEDS_GOODS 有专属文案（不是网络问题、重试无用），库存不足/未知错误码各自分诊', () => {
    expect(checkout.mapCreateOrderError('COUPON_EXCEEDS_GOODS')).toBe('优惠券暂不支持抵扣这单，请调整商品数量')
    expect(checkout.mapCreateOrderError('OUT_OF_STOCK:p1')).toBe('有商品库存不足')
    expect(checkout.mapCreateOrderError('WEIRD_CODE')).toBe('下单没成功，稍后再试')
    expect(checkout.mapCreateOrderError('')).toBe('下单没成功，稍后再试')
  })
})

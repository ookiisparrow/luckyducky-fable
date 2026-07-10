// 黄金 frontend-store §一（购物车含 SKU 行身份）/§二（持久化回灌脏数据闸）/§四（金额恒两位小数）
// （守卫 rw-mp-cart-golden）。wx.storage 以内存桩替代（持久化链路真机验·根因#8 记档）。
import { describe, it, expect, beforeEach } from 'vitest'
import * as cart from '../lib/cart'

let storage: Record<string, unknown> = {}
;(globalThis as any).wx = {
  getStorageSync: (k: string) => storage[k],
  setStorageSync: (k: string, v: unknown) => {
    storage[k] = JSON.parse(JSON.stringify(v))
  },
}

const DUCK = { id: 'p1', name: '小鸭', price: 128, cover: 'c1' }

beforeEach(() => {
  storage = {}
  cart.__resetForTest()
})

describe('行身份与加购（黄金 §一）', () => {
  it('大白话：新商品入车一条数量 1；再加同商品 +1 不重复建行；不同规格各成独立行；改量/删除按双键定位不串行', () => {
    cart.add(DUCK)
    cart.add(DUCK)
    expect(cart.getItems()).toHaveLength(1)
    expect(cart.getItems()[0].qty).toBe(2)
    cart.add({ ...DUCK, sku: '云朵白', price: 138 })
    expect(cart.getItems()).toHaveLength(2) // 不同规格独立行
    cart.setQty('p1', 5, '云朵白')
    expect(cart.getItems().find((i) => i.sku === '云朵白')!.qty).toBe(5)
    expect(cart.getItems().find((i) => i.sku === '')!.qty).toBe(2) // 不串到空规格行
    cart.remove('p1', '云朵白')
    expect(cart.getItems()).toHaveLength(1)
    expect(cart.getItems()[0].sku).toBe('') // 删规格行不误删邻行
    cart.setQty('p1', 0)
    expect(cart.getItems()[0].qty).toBe(1) // 数量钳位 ≥1
  })

  it('大白话：lineId（wx:key 用·批5）＝id+sku 双键合成——同 id 异 sku 不撞、同 id+sku 唯一稳定', () => {
    cart.add(DUCK)
    cart.add({ ...DUCK, sku: '云朵白', price: 138 })
    const items = cart.getItems()
    const ids = items.map((i) => i.lineId)
    expect(new Set(ids).size).toBe(2) // 同 id 异 sku 不撞 key
    expect(items.find((i) => i.sku === '')!.lineId).toBe('p1__')
    expect(items.find((i) => i.sku === '云朵白')!.lineId).toBe('p1__云朵白')
    expect(cart.lineIdOf('p1', '')).toBe('p1__')
  })

  it('大白话：选中计数/合计只算选中项；合计分累加不漂且恒两位小数', () => {
    cart.add({ id: 'a', name: '甲', price: 19.99 }) // 19.99×100 浮点=1998.9999999999998
    cart.add({ id: 'b', name: '乙', price: 0.07 }) // 0.07×100 浮点=7.000000000000001
    cart.add({ id: 'c', name: '丙', price: 99 })
    cart.toggle('c') // 取消丙
    expect(cart.selectedCount()).toBe(2)
    expect(cart.selectedTotalLabel()).toBe('¥20.06')
    // 分口径必须是精确整数（结算下单同一口径·钱链纪律）：浮点直加得 2006.0000000000002 过不了
    expect(cart.selectedTotalFen()).toBe(2006)
    expect(Number.isInteger(cart.selectedTotalFen())).toBe(true)
    cart.toggleAll() // 全不选 → 全选
    expect(cart.allSelected()).toBe(true)
    expect(cart.selectedTotalLabel()).toBe('¥119.06')
  })

  it('大白话：结算按提交数量精确扣——只买走部分剩余保留；全量买走整行移除；同商品其他规格行不受影响', () => {
    cart.add(DUCK)
    cart.setQty('p1', 3)
    cart.add({ ...DUCK, sku: '云朵白', price: 138 })
    cart.consume([{ id: 'p1', sku: '', qty: 1 }]) // 3 件只买 1
    expect(cart.getItems().find((i) => i.sku === '')!.qty).toBe(2) // 剩余保留·不误删整条
    cart.consume([{ id: 'p1', sku: '云朵白', qty: 1 }]) // 规格行全量买走
    const rest = cart.getItems()
    expect(rest).toHaveLength(1) // 规格行移除·无 qty≤0 死行
    expect(rest[0].sku).toBe('')
    expect(rest[0].qty).toBe(2)
  })
})

describe('持久化回灌（黄金 §二：脏数据闸）', () => {
  it('大白话：残缺条目（无数量/数量非正/小数数量/无标识/空对象）一律丢弃；有效条目 selected 归一布尔、规格缺失归一空串；坏存档不崩退空车', () => {
    storage['ld:cart'] = {
      items: [
        { id: 'ok', name: '好条目', price: 10, qty: 2, selected: 1 }, // selected 归一
        { id: 'x1', name: '无数量', price: 10 },
        { id: 'x2', name: '零数量', price: 10, qty: 0 },
        { id: 'x3', name: '小数数量', price: 10, qty: 0.5 }, // 丢弃不 floor
        { name: '无标识', price: 10, qty: 1 },
        { id: 'x4', name: '价非数字', price: '10', qty: 1 },
        {},
        null,
      ],
    }
    const items = cart.getItems()
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ id: 'ok', qty: 2, selected: true, sku: '' })
    // 坏存档：storage 抛错 → 空车不崩
    cart.__resetForTest()
    ;(globalThis as any).wx.getStorageSync = () => {
      throw new Error('corrupt')
    }
    expect(cart.getItems()).toEqual([])
    ;(globalThis as any).wx.getStorageSync = (k: string) => storage[k]
  })

  it('大白话：加购后换会话（冷启动）购物车还在——写进存储、回灌可复原', () => {
    cart.add(DUCK)
    cart.add({ ...DUCK, sku: '云朵白', price: 138 })
    cart.__resetForTest() // 模拟冷启动：内存清空·从存储回灌
    const items = cart.getItems()
    expect(items).toHaveLength(2)
    expect(items.map((i) => i.sku).sort()).toEqual(['', '云朵白'])
  })

  it('大白话：bump 相对增减读内存最新 qty（不靠渲染层旧值）·连点两次 +1 累加不丢·钳位 ≥1·按 SKU 行独立', () => {
    cart.add(DUCK)
    cart.add({ ...DUCK, sku: '云朵白', price: 138 })
    cart.bump('p1', 1) // 无 sku 行 1→2
    cart.bump('p1', 1) // 读内存最新 2→3（渲染层旧值仍是 1 也不丢增量·lost-update 根治）
    expect(cart.getItems().find((i) => i.sku === '')!.qty).toBe(3)
    expect(cart.getItems().find((i) => i.sku === '云朵白')!.qty).toBe(1) // 另一 SKU 行不受影响
    cart.bump('p1', -5) // 钳位 ≥1
    expect(cart.getItems().find((i) => i.sku === '')!.qty).toBe(1)
  })
})

describe('展示 cover 覆盖（批B 图片链提速回归：持久 cover 过期挂图）', () => {
  it('大白话：allRaw 里查得到该商品且 cover 非空 → 用最新 cover 覆盖展示；查不到/该商品 cover 为空 → 回退存量持久 cover', () => {
    const line = { id: 'p1', cover: 'https://stale.example/expired.jpg' }
    expect(cart.freshCover(line, [{ id: 'p1', cover: 'https://fresh.example/new.jpg' }])).toBe('https://fresh.example/new.jpg')
    expect(cart.freshCover(line, [{ id: 'p1', cover: '' }])).toBe(line.cover) // 原档 cover 空→回退存量
    expect(cart.freshCover(line, [{ id: 'other', cover: 'https://fresh.example/x.jpg' }])).toBe(line.cover) // 商品已删/不在原档→回退存量
    expect(cart.freshCover(line, [])).toBe(line.cover) // 原档未加载（空数组）→回退存量
  })
})

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { dateTime } from '@/utils/format.js'

// T1 砍多端：api 只对接云。测试 mock callCloud 提供云响应，测 store 编排逻辑。
// 订单定价/快照/契约拒单/SKU 的真实校验在 tests/cloud/createOrder.test.js（云端唯一权威，
// 不再有本地镜像可测——根因账本 #6）。
const { callCloud } = vi.hoisted(() => ({ callCloud: vi.fn() }))
vi.mock('@/utils/cloud.js', () => ({ callCloud, initCloud: vi.fn(), uploadCloudFile: vi.fn() }))

import { useOrdersStore } from '@/store/orders.js'

let seq = 0
beforeEach(() => {
  setActivePinia(createPinia())
  seq = 0
  callCloud.mockImplementation(async (name, data) => {
    if (name === 'createOrder') {
      return {
        ok: true,
        order: {
          id: 'ord' + ++seq,
          status: 'paid',
          amount: 100,
          items: (data?.items || []).map((i) => ({ productId: i.id, qty: i.qty })),
        },
      }
    }
    if (name === 'getMyOrders') return { ok: true, list: [] }
    if (name === 'confirmReceive') return { ok: true, doneAt: 1234 }
    return null
  })
})

describe('orders store（云路径，mock callCloud）', () => {
  it('create 后 getById 取到同一笔（提交 → 详情贯通）', async () => {
    const store = useOrdersStore()
    const o = await store.create({ items: [{ id: 'prod-3', qty: 1 }], address: {} })
    expect(store.getById(o.id)).toBe(store.list[0])
    expect(store.getById(o.id).id).toBe(o.id)
  })

  it('load 拉远端列表（砍多端后无本地回退单）', async () => {
    callCloud.mockImplementation(async (name) =>
      name === 'getMyOrders' ? { ok: true, list: [{ id: 'r1', status: 'shipped' }] } : null
    )
    const store = useOrdersStore()
    await store.load()
    expect(store.getById('r1')).toBeTruthy()
  })

  it('load 归一脏订单 items：缺 items 的远端单入库后 items 恒为数组（防列表 qtyOf / 详情 cfgFromOrder 的 .items 白屏·根因#8）', async () => {
    // 真实数据形状：手工写库/历史 schema 的订单可能没有 items；列表「全部」渲染所有单，
    // 一条坏数据就让 o.items.reduce 抛 → 整页白屏（devtools 实测 "reduce of undefined"）。
    callCloud.mockImplementation(async (name) =>
      name === 'getMyOrders' ? { ok: true, list: [{ id: 'bad1', status: 'paid' /* 无 items */ }] } : null
    )
    const store = useOrdersStore()
    await store.load()
    const o = store.getById('bad1')
    expect(Array.isArray(o.items)).toBe(true) // 归一前 undefined → 红
    // 列表渲染热点：qtyOf 对脏单不抛（「共 N 件」），详情 cfgFromOrder 的 items.map 同理
    expect(() => o.items.reduce((s, it) => s + it.qty, 0)).not.toThrow()
  })

  it('fetchById 归一脏订单 items：单独取回的老单缺 items 也补成数组（详情兜底同样防白屏）', async () => {
    callCloud.mockImplementation(async (name) =>
      name === 'getOrderById' ? { ok: true, order: { id: 'old1', status: 'done' /* 无 items */ } } : null
    )
    const store = useOrdersStore()
    await store.fetchById('old1')
    expect(Array.isArray(store.getById('old1').items)).toBe(true)
  })

  it('confirmReceive：shipped 单确认收货翻 done 并记 doneAt（详情/列表响应式刷新）', async () => {
    const store = useOrdersStore()
    store.list = [{ id: 'x9', status: 'shipped', items: [] }]
    await store.confirmReceive('x9')
    expect(store.getById('x9').status).toBe('done')
    expect(store.getById('x9').doneAt).toBe(1234)
  })

  it('countByStatus：按状态计数（「我」页角标 / 列表 tab 数据源）', async () => {
    const store = useOrdersStore()
    await store.create({ items: [{ id: 'prod-1', qty: 1 }], address: {} })
    await store.create({ items: [{ id: 'prod-2', qty: 1 }], address: {} })
    expect(store.countByStatus.paid).toBe(2)
    expect(store.countByStatus.pending).toBeUndefined()
    store.list = [...store.list, { id: 'x1', status: 'shipped', items: [] }]
    expect(store.countByStatus.shipped).toBe(1)
  })
})

describe('format.dateTime', () => {
  it('epoch 毫秒 → YYYY-MM-DD HH:mm；非法值返回空串', () => {
    expect(dateTime(new Date(2026, 5, 10, 9, 5).getTime())).toBe('2026-06-10 09:05')
    expect(dateTime(null)).toBe('')
    expect(dateTime('abc')).toBe('')
  })
})

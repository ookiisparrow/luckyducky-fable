// app 端订单：原型键不当商品/搭配购、读失败不伪装成「订单不存在」，以及 orderNo 单号形状锁。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as app } from '../src/functions/app/index'

const call = (action: string, data: Record<string, unknown> = {}) => app({ action, data }) as Promise<any>
const ADDR = { name: '张三', phone: '13800000000', region: '浙江·杭州', detail: 'xx 路 1 号' }

beforeEach(() => {
  control.reset()
  control.setOpenId('oME')
  process.env.ALLOW_MOCK_PAY = '1'
  control.seed('products', [{ _id: 'p1', id: 'p1', name: '小鸭礼盒', price: 198, tag: '基础款' }])
})
afterEach(() => {
  delete process.env.ALLOW_MOCK_PAY
  vi.restoreAllMocks()
})

describe('createOrder：Object.prototype 上的键不是商品也不是搭配购', () => {
  for (const id of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    it(`items 夹带 ${id} → UNKNOWN_ITEM 拒单，不抛进顶层兜底记 anomaly`, async () => {
      const r = await call('createOrder', { items: [{ id: 'p1', qty: 1 }, { id, qty: 1 }], address: ADDR })
      expect(r.error).toBe('UNKNOWN_ITEM:' + id)
      expect(control.dump('anomalies')).toEqual([])
      expect(control.dump('orders')).toEqual([])
    })
  }

  it('只买一个原型键 → UNKNOWN_ITEM（不被当成「只有搭配购」回 NO_MAIN_ITEM）', async () => {
    const r = await call('createOrder', { items: [{ id: 'toString', qty: 1 }], address: ADDR })
    expect(r.error).toBe('UNKNOWN_ITEM:toString')
  })
})

describe('getOrderById：读失败 ≠ 订单不存在', () => {
  beforeEach(() => {
    control.seed('orders', [{ _id: 'o1', id: 'o1', _openid: 'oME', status: 'paid', amount: 198, items: [] }])
  })

  it('订单读瞬时失败 → INTERNAL（前端给重试），不是 NOT_FOUND', async () => {
    control.setBeforeGet(async (a: any) => {
      if (a.coll === 'orders' && a.id === 'o1') throw new Error('MOCK_READ_FAIL')
    })
    const r = await call('getOrderById', { id: 'o1' })
    expect(r.error).toBe('INTERNAL')
  })

  it('真没有这单 / 他人单 → NOT_FOUND（不变）', async () => {
    expect((await call('getOrderById', { id: 'ghost' })).error).toBe('NOT_FOUND')
    control.setOpenId('oOTHER')
    expect((await call('getOrderById', { id: 'o1' })).error).toBe('NOT_FOUND')
  })
})

describe('createOrder 地址快照：截断上限 / 去空白 / 数字手机号 / 四要素必填', () => {
  const order = (address: unknown) => call('createOrder', { items: [{ id: 'p1', qty: 1 }], address })

  it('各字段按 40/20/60/120 截断、先 trim；数字手机号按字符串收', async () => {
    const r = await order({ name: ' ' + '名'.repeat(50), phone: 13800000000, region: '区'.repeat(70) + '  ', detail: 'x'.repeat(300) })
    expect(r.order.address).toEqual({ name: '名'.repeat(40), phone: '13800000000', region: '区'.repeat(60), detail: 'x'.repeat(120) })
    const long = await order({ ...ADDR, phone: '1'.repeat(30) })
    expect(long.order.address.phone).toBe('1'.repeat(20))
  })

  it('任一要素缺/全空白 → BAD_ADDRESS；电话数字不足 7 位 → BAD_ADDRESS', async () => {
    for (const k of ['name', 'phone', 'region', 'detail']) {
      expect((await order({ ...ADDR, [k]: '   ' })).error).toBe('BAD_ADDRESS')
      expect((await order({ ...ADDR, [k]: undefined })).error).toBe('BAD_ADDRESS')
    }
    expect((await order({ ...ADDR, phone: '12-34-56' })).error).toBe('BAD_ADDRESS')
    expect((await order({ ...ADDR, phone: '123-4567' })).ok).toBe(true)
    expect((await call('createOrder', { items: [{ id: 'p1', qty: 1 }] })).error).toBe('BAD_ADDRESS')
    expect(control.dump('orders').length).toBe(1)
  })
})

describe('orderNo：yyyyMMddHHmm（北京时间）+ 4 位随机', () => {
  it('单号形状与取值锁定', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-01-02T20:07:59.999Z')) // 北京时间 2026-01-03 04:07
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const r = await call('createOrder', { items: [{ id: 'p1', qty: 1 }], address: ADDR })
    expect(r.order.id).toBe('202601030407' + '5500')
    expect(r.order._id).toBe(r.order.id)
  })

  it('跨年边界：UTC 12-31 16:00 已是北京时间次年 1 月 1 日 00:00', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-12-31T16:00:00Z'))
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const r = await call('createOrder', { items: [{ id: 'p1', qty: 1 }], address: ADDR })
    expect(r.order.id).toBe('202701010000' + '1000')
  })
})

describe('createOrder：add 抛错后的读回，只有「确无此单」才换号', () => {
  beforeEach(() => {
    control.seed('inventory', [{ _id: 'p1__基础款', productId: 'p1', spec: '基础款', stock: 5 }])
  })
  afterEach(() => {
    control.setBeforeAdd(null as never)
    control.setBeforeGet(null as never)
  })
  const failFirstOrderAdd = () => {
    let failed = false
    control.setBeforeAdd(async ({ coll }: any) => {
      if (coll === 'orders' && !failed) {
        failed = true
        throw new Error('SDK_TIMEOUT')
      }
    })
  }

  it('读回确认缺档 → 换号重试建成一单，库存只扣一次', async () => {
    failFirstOrderAdd()
    const r = await call('createOrder', { items: [{ id: 'p1', qty: 1 }], address: ADDR })
    expect(r.ok).toBe(true)
    expect(control.dump('orders').length).toBe(1)
    expect(control.dump('inventory')[0].stock).toBe(4)
  })

  it('读回本身失败 → PENDING：不换号、不回补预留、幂等键保留，并告警', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    failFirstOrderAdd()
    control.setBeforeGet(async (a: any) => {
      if (a.coll === 'orders' && a.id) throw new Error('MOCK_READ_FAIL')
    })
    const r = await call('createOrder', { items: [{ id: 'p1', qty: 1 }], address: ADDR, idempotencyKey: 'k1' })
    expect(r.error).toBe('ORDER_CLAIM_PENDING')
    expect(control.dump('orders')).toEqual([])
    expect(control.dump('inventory')[0].stock).toBe(4)
    expect(control.dump('orderIdempotency').length).toBe(1)
    expect(spy.mock.calls.some((c) => String(c[0]).includes('code=ORDER_READBACK_FAIL'))).toBe(true)
  })
})

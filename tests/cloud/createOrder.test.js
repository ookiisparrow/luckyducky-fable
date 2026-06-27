import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { control } from 'wx-server-sdk'
import { main } from '../../packages/cloud/src/functions/orders/createOrder'

// createOrder 闸门：openid / 契约 / 云端定价（不信任前端价）/ SKU 校验 / 金额 /
// 服务端不变量（主商品必含 + 地址四要素，审核批次A-4）/ 订单号防碰撞。
const ADDR = { name: '陈圆圆', phone: '13800001234', region: '浙江杭州', detail: '未来路 1 号' }

beforeEach(() => {
  control.reset()
  control.setOpenId('user-A')
  process.env.ALLOW_MOCK_PAY = '1' // 测试/开发默认开 mock（生产永不设）；fail-closed 用例内显式删
  control.seed('products', [
    { _id: 'prod-1', id: 'prod-1', name: '小棉鸭礼盒', tag: '送礼首选', price: 198, skus: [{ name: '雾霭蓝', price: 210 }] },
    { _id: 'prod-3', id: 'prod-3', name: '微笑小鸡', tag: '零基础', price: 128, skus: [] },
  ])
})

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.ALLOW_MOCK_PAY
})

// 停售商品挡交易入口（审核 P1·债#12·根因#3 fail-closed）：软下架（listed:false）此前只挡 getProducts
// 列表，createOrder 不校验——旧购物车/缓存/直调云函数仍能买。本组锁「下单入口拒停售品·不建单·不扣库存」。
describe('createOrder 停售商品挡交易入口（审核 P1·债#12·根因#3）', () => {
  beforeEach(() => {
    control.seed('products', [
      { _id: 'gone', id: 'gone', name: '已停售礼盒', price: 88, skus: [], listed: false },
    ])
  })

  it('UNLISTED_ITEM：已停售主商品（listed:false）拒单·不建单·不扣库存', async () => {
    control.seed('inventory', [{ _id: 'gone__', productId: 'gone', spec: '', stock: 5 }])
    const r = await main({ items: [{ id: 'gone', qty: 1 }], address: ADDR })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('UNLISTED_ITEM:gone')
    expect(control.dump('orders').length).toBe(0) // 没建单
    expect(control.dump('inventory').find((d) => d._id === 'gone__').stock).toBe(5) // 库存没扣
  })

  it('停售品夹带在多条目里：整单拒（不放过夹带）', async () => {
    const r = await main({
      items: [{ id: 'prod-1', qty: 1, sku: '雾霭蓝' }, { id: 'gone', qty: 1 }],
      address: ADDR,
    })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('UNLISTED_ITEM:gone')
    expect(control.dump('orders').length).toBe(0)
  })

  it('P2.13：地址超长字段云端截断（防超长入库·不信前端长度）', async () => {
    const longAddr = { name: 'x'.repeat(100), phone: '1'.repeat(50), region: '省'.repeat(100), detail: '街'.repeat(300) }
    const r = await main({ items: [{ id: 'prod-1', qty: 1, sku: '雾霭蓝' }], address: longAddr })
    expect(r.ok).toBe(true)
    expect(r.order.address.name).toHaveLength(40)
    expect(r.order.address.phone).toHaveLength(20)
    expect(r.order.address.region).toHaveLength(60)
    expect(r.order.address.detail).toHaveLength(120)
  })

  it('在售商品（listed:true / 旧无字段）不受影响', async () => {
    const r1 = await main({ items: [{ id: 'prod-1', qty: 1, sku: '雾霭蓝' }], address: ADDR }) // 旧无字段=可售
    expect(r1.ok).toBe(true)
    control.seed('products', [{ _id: 'live', id: 'live', name: '在售', price: 50, skus: [], listed: true }])
    const r2 = await main({ items: [{ id: 'live', qty: 1 }], address: ADDR })
    expect(r2.ok).toBe(true)
  })
})

describe('createOrder 闸门', () => {
  it('NO_OPENID：未登录拒单', async () => {
    control.setOpenId('')
    expect(await main({ items: [{ id: 'prod-1', qty: 1 }] })).toEqual({ ok: false, error: 'NO_OPENID' })
  })

  it('EMPTY_ITEMS：空条目 / 非整数 qty 一律拒', async () => {
    expect((await main({ items: [] })).error).toBe('EMPTY_ITEMS')
    expect((await main({ items: [{ id: 'prod-1', qty: 0.5 }] })).error).toBe('EMPTY_ITEMS')
    expect((await main({ items: [{ id: 'prod-1', qty: 0 }] })).error).toBe('EMPTY_ITEMS')
  })

  it('BAD_QTY / TOO_MANY_ITEMS：数量与条数硬上限，拦超大单穿透（外部体检 P1）', async () => {
    expect((await main({ items: [{ id: 'prod-1', qty: 1000 }], address: ADDR })).error).toBe('BAD_QTY')
    const many = Array.from({ length: 101 }, () => ({ id: 'prod-1', qty: 1 }))
    expect((await main({ items: many, address: ADDR })).error).toBe('TOO_MANY_ITEMS')
  })

  it('NO_MAIN_ITEM：只买搭配购整单拒（服务端不变量，前端守卫的云端对等物）', async () => {
    expect((await main({ items: [{ id: 'yarn', qty: 1 }], address: ADDR })).error).toBe('NO_MAIN_ITEM')
    expect((await main({ items: [{ id: 'yarn', qty: 1 }, { id: 'hook', qty: 1 }], address: ADDR })).error).toBe('NO_MAIN_ITEM')
  })

  it('UNKNOWN_ITEM：商品不在云端 products 整单拒', async () => {
    expect((await main({ items: [{ id: 'nope', qty: 1 }] })).error).toBe('UNKNOWN_ITEM:nope')
  })

  it('价格以云端为准：前端传伪造 price 被忽略', async () => {
    const res = await main({ items: [{ id: 'prod-1', qty: 2, price: 1 }], address: ADDR })
    expect(res.ok).toBe(true)
    expect(res.order.goods).toBe(198 * 2) // 用云端 198，不是前端的 1
    expect(res.order.amount).toBe(198 * 2 - 20) // - COUPON
  })

  it('金额按分整数运算、无浮点漂移（外部 review P2 / 根因#4）', async () => {
    control.seed('products', [{ _id: 'p-dec', id: 'p-dec', name: '小数价', price: 19.9, skus: [] }])
    const res = await main({ items: [{ id: 'p-dec', qty: 3 }], address: ADDR })
    expect(res.ok).toBe(true)
    expect(res.order.goods).toBe(59.7) // 元浮点 sum 会得 59.699999…；分整数运算精确
    expect(res.order.amount).toBe(39.7) // 59.7 - 20
  })

  it('库内脏价 fail-closed：负价主商品 / 超大 SKU 价拒单（审计 P1，交易最终关口）', async () => {
    control.seed('products', [
      { _id: 'p-bad', id: 'p-bad', name: '脏价', price: -5, skus: [] },
      { _id: 'p-sku', id: 'p-sku', name: '脏SKU', price: 100, skus: [{ name: '大', price: 200000 }] },
    ])
    expect((await main({ items: [{ id: 'p-bad', qty: 1 }], address: ADDR })).error).toBe('BAD_PRICE:p-bad')
    expect(
      (await main({ items: [{ id: 'p-sku', qty: 1, sku: '大' }], address: ADDR })).error,
    ).toBe('BAD_SKU_PRICE:p-sku:大')
  })

  it('SKU 命中：价格用云端 sku 价，规格名进快照 spec', async () => {
    const res = await main({ items: [{ id: 'prod-1', qty: 1, sku: '雾霭蓝' }], address: ADDR })
    expect(res.order.items[0].price).toBe(210)
    expect(res.order.items[0].spec).toBe('雾霭蓝')
  })

  it('UNKNOWN_SKU：传了云端不存在的规格整单拒', async () => {
    expect((await main({ items: [{ id: 'prod-1', qty: 1, sku: '不存在' }] })).error).toBe(
      'UNKNOWN_SKU:prod-1:不存在',
    )
  })

  it('ADDONS 搭配购随主商品：价格用云端硬编码表', async () => {
    const res = await main({ items: [{ id: 'prod-3', qty: 1 }, { id: 'yarn', qty: 1 }], address: ADDR })
    expect(res.ok).toBe(true)
    const yarn = res.order.items.find((it) => it.productId === 'yarn')
    expect(yarn.price).toBe(29)
    expect(yarn.name).toContain('补充棉线包')
  })

  it('BAD_ADDRESS：地址四要素缺一即拒、手机号过短拒（服务端必填校验）', async () => {
    expect((await main({ items: [{ id: 'prod-3', qty: 1 }] })).error).toBe('BAD_ADDRESS') // 无地址
    expect((await main({ items: [{ id: 'prod-3', qty: 1 }], address: { ...ADDR, detail: '' } })).error).toBe('BAD_ADDRESS')
    expect((await main({ items: [{ id: 'prod-3', qty: 1 }], address: { ...ADDR, phone: '138' } })).error).toBe('BAD_ADDRESS')
  })

  it('地址白名单：多余字段被丢弃，status=paid，订单落库', async () => {
    const res = await main({
      items: [{ id: 'prod-3', qty: 1 }],
      address: { ...ADDR, evil: '应被丢' },
    })
    expect(res.order.address).toEqual(ADDR)
    expect(res.order.status).toBe('paid')
    expect(res.order.paidAt).toBeGreaterThan(0)
    expect(res.order.id).toMatch(/^\d{16}$/)
    const saved = control.dump('orders')
    expect(saved).toHaveLength(1)
    expect(saved[0]._openid).toBe('user-A')
  })

  it('订单号撞号不覆盖旧单：库级唯一 + 重试，耗尽返回 ORDER_ID_BUSY', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.42) // 固定随机数 → 同分钟内订单号必然相同
    const first = await main({ items: [{ id: 'prod-3', qty: 1 }], address: ADDR })
    expect(first.ok).toBe(true)
    const second = await main({ items: [{ id: 'prod-1', qty: 1 }], address: ADDR })
    expect(second.error).toBe('ORDER_ID_BUSY') // 5 次重试全撞同号，拒单而非覆盖
    const saved = control.dump('orders')
    expect(saved).toHaveLength(1)
    expect(saved[0].items[0].productId).toBe('prod-3') // 旧单原封不动
  })
})

describe('createOrder PAY_MODE 开关（规格 §三 · fail-closed 根因#3）', () => {
  it('ALLOW_MOCK_PAY=1（开发/测试）+ 缺 config = mock：直接 paid + paidAt', async () => {
    const res = await main({ items: [{ id: 'prod-3', qty: 1 }], address: ADDR })
    expect(res.order.status).toBe('paid')
    expect(res.order.paidAt).toBeGreaterThan(0)
  })

  it('mode=real：写 pending、不记 paidAt，等支付回调（env 无关）', async () => {
    control.seed('config', [{ _id: 'pay', mode: 'real', subMchId: '1900000000' }])
    const res = await main({ items: [{ id: 'prod-3', qty: 1 }], address: ADDR })
    expect(res.order.status).toBe('pending')
    expect(res.order.paidAt).toBeUndefined()
    const saved = control.dump('orders')[0]
    expect(saved.status).toBe('pending')
    expect(saved.paidAt).toBeUndefined()
  })

  it('生产 fail-closed（无 ALLOW_MOCK_PAY）：缺 config 不伪造已付单，拒 PAY_CONFIG_MISSING、不落库', async () => {
    delete process.env.ALLOW_MOCK_PAY // 模拟生产：mock 开关未开
    const res = await main({ items: [{ id: 'prod-3', qty: 1 }], address: ADDR })
    expect(res).toEqual({ ok: false, error: 'PAY_CONFIG_MISSING' })
    expect(control.dump('orders')).toHaveLength(0) // 关键：拒单不得生成任何订单
  })

  it('生产 fail-closed：显式 mode=mock 也拒（env 才是安全闸，DB 配置不能伪造已付）', async () => {
    delete process.env.ALLOW_MOCK_PAY
    control.seed('config', [{ _id: 'pay', mode: 'mock' }])
    const res = await main({ items: [{ id: 'prod-3', qty: 1 }], address: ADDR })
    expect(res.error).toBe('PAY_CONFIG_MISSING')
    expect(control.dump('orders')).toHaveLength(0)
  })
})

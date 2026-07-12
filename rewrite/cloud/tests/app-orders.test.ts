// 黄金 orders-money（createOrder/关单）+ inventory-scm §A/§B/§C（守卫 rw-money1-golden）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import cloud, { control } from 'wx-server-sdk'
import { main as app } from '../src/functions/app/index'
import { main as closeExpired } from '../src/functions/timers/closeExpiredOrders'
import { setStock } from '../src/kit'

const call = (action: string, data: Record<string, unknown> = {}) => app({ action, data }) as Promise<any>

const ADDR = { name: '张三', phone: '13800000000', region: '浙江·杭州', detail: 'xx 路 1 号' }
const order = (items: unknown, address: unknown = ADDR) => call('createOrder', { items, address })

beforeEach(() => {
  control.reset()
  control.setOpenId('oME')
  process.env.ALLOW_MOCK_PAY = '1' // 测试环境显式放行 mock（生产永不设）
  control.seed('products', [
    { _id: 'p1', id: 'p1', name: '小鸭礼盒', price: 198, tag: '基础款' },
    {
      _id: 'p2',
      id: 'p2',
      name: '小熊礼盒',
      price: 208,
      skus: [
        { name: '雾霭蓝', price: 218 },
        { name: '脏价', price: -5 },
      ],
    },
    { _id: 'pOff', id: 'pOff', name: '停售品', price: 99, listed: false },
    { _id: 'pBad', id: 'pBad', name: '脏价品', price: -1 },
  ])
})
afterEach(() => {
  delete process.env.ALLOW_MOCK_PAY
  vi.restoreAllMocks() // 换址失败测试会 spyOn cloud.getTempFileURL·收尾必还原不漏到下个用例
})

describe('createOrder · 契约与定价（黄金 orders-money）', () => {
  it('大白话：未登录拒；空条目/非法数量/超上限拒；只买搭配购无主商品拒', async () => {
    control.setOpenId('')
    expect((await order([{ id: 'p1', qty: 1 }])).error).toBe('NO_OPENID')
    control.setOpenId('oME')
    expect((await order([])).error).toBe('EMPTY_ITEMS')
    expect((await order([{ id: 'p1', qty: 0.5 }])).error).toBe('EMPTY_ITEMS')
    expect((await order([{ id: 'p1', qty: 1000 }])).error).toBe('BAD_QTY')
    expect((await order([{ id: 'hook', qty: 1 }])).error).toBe('NO_MAIN_ITEM')
  })

  it('大白话：未知商品/未知规格整单拒；停售品整单拒（夹带也拒）——不建单不扣库存', async () => {
    expect((await order([{ id: 'ghost', qty: 1 }])).error).toContain('UNKNOWN_ITEM')
    expect((await order([{ id: 'p2', qty: 1, sku: '不存在' }])).error).toContain('UNKNOWN_SKU')
    expect((await order([{ id: 'pOff', qty: 1 }])).error).toContain('UNLISTED_ITEM')
    expect((await order([{ id: 'p1', qty: 1 }, { id: 'pOff', qty: 1 }])).error).toContain('UNLISTED_ITEM')
    expect(control.dump('orders').length).toBe(0)
  })

  it('大白话：价格云端现算——前端传价忽略；SKU 命中取 SKU 价并进规格快照；金额分整数无漂移；券抵扣', async () => {
    const r = await order([
      { id: 'p1', qty: 3, price: 1 }, // 伪造低价被忽略
      { id: 'p2', qty: 1, sku: '雾霭蓝' },
      { id: 'hook', qty: 1 },
    ])
    expect(r.ok).toBe(true)
    const o = r.order
    const line2 = o.items.find((i: any) => i.productId === 'p2')
    expect(line2.price).toBe(218)
    expect(line2.spec).toBe('雾霭蓝')
    expect(line2.lineId).toBe('p2__雾霭蓝')
    expect(o.goods).toBe(198 * 3 + 218 + 39)
    expect(o.amount).toBe(o.goods - 20) // 券 20·包邮
  })

  it('大白话：库内脏价 fail-closed——主价/SKU 价非法整单拒（历史脏数据不放行）', async () => {
    expect((await order([{ id: 'pBad', qty: 1 }])).error).toContain('BAD_PRICE')
    expect((await order([{ id: 'p2', qty: 1, sku: '脏价' }])).error).toContain('BAD_SKU_PRICE')
  })

  it('大白话：分整数运算——三件 19.9 精确得 59.7 不出浮点尾巴', async () => {
    control.seed('products', [{ _id: 'p9', id: 'p9', name: '小件', price: 19.9 }])
    const r = await order([{ id: 'p9', qty: 3 }])
    expect(r.order.goods).toBe(59.7)
  })

  it('大白话：占位券吞穿地板即拒单——单件 19.9 被 20 元券抵到 0 元不白送（深审 2026-07-05）', async () => {
    control.seed('products', [{ _id: 'p9', id: 'p9', name: '小件', price: 19.9 }])
    const r = await order([{ id: 'p9', qty: 1 }])
    expect(r.error).toBe('COUPON_EXCEEDS_GOODS')
  })

  it('大白话：地址四要素缺一拒、电话过短拒；超长截断、非白名单字段丢弃', async () => {
    expect((await order([{ id: 'p1', qty: 1 }], { ...ADDR, detail: '' })).error).toBe('BAD_ADDRESS')
    expect((await order([{ id: 'p1', qty: 1 }], { ...ADDR, phone: '123' })).error).toBe('BAD_ADDRESS')
    const r = await order([{ id: 'p1', qty: 1 }], { ...ADDR, detail: 'x'.repeat(300), hack: '注入' })
    expect(r.order.address.detail.length).toBe(120)
    expect(r.order.address.hack).toBeUndefined()
  })

  it('大白话：支付配置 fail-closed——mock 只认环境级开关，库内配置声称 mock 不作数；real 落待支付不记支付时间', async () => {
    delete process.env.ALLOW_MOCK_PAY
    control.seed('config', [{ _id: 'pay', mode: 'mock' }]) // 可篡改数据不当安全闸
    expect((await order([{ id: 'p1', qty: 1 }])).error).toBe('PAY_CONFIG_MISSING')

    control.reset()
    control.setOpenId('oME')
    control.seed('products', [{ _id: 'p1', id: 'p1', name: '鸭', price: 198 }])
    control.seed('config', [{ _id: 'pay', mode: 'real' }])
    const r = await order([{ id: 'p1', qty: 1 }])
    expect(r.order.status).toBe('pending')
    expect(r.order.paidAt).toBeUndefined()
  })

  it('大白话：mock 放行时落已付并记支付时间（开发态）', async () => {
    const r = await order([{ id: 'p1', qty: 1 }])
    expect(r.order.status).toBe('paid')
    expect(r.order.paidAt).toBeGreaterThan(0)
  })

  it('大白话：下单时把商品封面快照进订单行（历史快照·不回读 catalog）；搭配购行封面为空串不留 undefined', async () => {
    control.seed('products', [{ _id: 'pc', id: 'pc', name: '带图礼盒', price: 50, cover: 'cloud://x/pc.jpg' }])
    const r = await order([
      { id: 'pc', qty: 1 },
      { id: 'hook', qty: 1 },
    ])
    expect(r.ok).toBe(true)
    const main = r.order.items.find((i: any) => i.productId === 'pc')
    expect(main.cover).toBe('cloud://x/pc.jpg') // 服务端从 products 快照·非前端上送
    const addon = r.order.items.find((i: any) => i.productId === 'hook')
    expect(addon.cover).toBe('') // 搭配购无封面→空串（形状一致·不留 undefined）
  })
})

describe('createOrder · 库存预留（黄金 inventory-scm §A/§B）', () => {
  it('大白话：下单即预留——扣减入预留清单；库存不足拒单不建单；无库存档＝不限量放行', async () => {
    control.seed('inventory', [{ _id: 'p1__基础款', productId: 'p1', spec: '基础款', stock: 1 }])
    const r1 = await order([{ id: 'p1', qty: 1 }])
    expect(r1.ok).toBe(true)
    expect(r1.order.reserved).toEqual([{ productId: 'p1', spec: '基础款', qty: 1 }])
    expect(control.dump('inventory')[0].stock).toBe(0)

    const r2 = await order([{ id: 'p1', qty: 1 }])
    expect(r2.error).toContain('OUT_OF_STOCK')
    expect(control.dump('orders').length).toBe(1)

    const r3 = await order([{ id: 'p2', qty: 1, sku: '雾霭蓝' }]) // 无库存档＝不限量
    expect(r3.ok).toBe(true)
    expect(r3.order.reserved).toEqual([])
  })

  it('大白话：多条目任一不足整单失败、已扣的其他条目全部回滚（不锁死库存）并指明短缺', async () => {
    control.seed('inventory', [
      { _id: 'p1__基础款', productId: 'p1', spec: '基础款', stock: 5 },
      { _id: 'p2__雾霭蓝', productId: 'p2', spec: '雾霭蓝', stock: 0 },
    ])
    const r = await order([
      { id: 'p1', qty: 2 },
      { id: 'p2', qty: 1, sku: '雾霭蓝' },
    ])
    expect(r.error).toContain('OUT_OF_STOCK:p2')
    expect(control.dump('inventory').find((x: any) => x._id === 'p1__基础款').stock).toBe(5) // 已回滚
  })

  it('大白话：并发抢最后一件只有一单成功，绝不超卖', async () => {
    control.seed('inventory', [{ _id: 'p1__基础款', productId: 'p1', spec: '基础款', stock: 1 }])
    const [a, b] = await Promise.all([order([{ id: 'p1', qty: 1 }]), order([{ id: 'p1', qty: 1 }])])
    const oks = [a, b].filter((r) => r.ok).length
    expect(oks).toBe(1)
    expect(control.dump('inventory')[0].stock).toBe(0)
  })

  it('大白话：add 写成功但 SDK 报错——读回本次 _id 命中即返回该单，不换号落第二张共享 reserved 的幽灵单（深审 P2 幂等）', async () => {
    // 模拟「写已持久化但 SDK 返回超时/网络错」：beforeAdd 先把本单落库、再抛错
    let injected = false
    control.setBeforeAdd(async ({ coll, data }: any) => {
      if (coll === 'orders' && !injected) {
        injected = true
        control.seed('orders', [data]) // 写其实成功了
        throw new Error('SDK_TIMEOUT') // 但 SDK 抛错
      }
    })
    const r = await order([{ id: 'p1', qty: 1 }])
    control.setBeforeAdd(null as never)
    expect(r.ok).toBe(true)
    // 只落一张单——旧版裸 catch 换号重试会落第二张、两单共享同一 reserved（关单双回补＝库存虚增/超卖）
    expect(control.dump('orders').length).toBe(1)
    expect(r.order._id).toBe(control.dump('orders')[0]._id)
  })
})

describe('setStock 管理端版本校验写（黄金 inventory-scm §A）', () => {
  it('大白话：期望版本不符（期间有并发预留）→ 冲突拒写不覆盖；相符落库；首设无条件写', async () => {
    // 确定性构造版本戳（真场景=管理员开旧页面期间发生并发预留；毫秒时钟在内存桩下会撞车，故直接铺数据）
    control.seed('inventory', [{ _id: 'p1__基础款', productId: 'p1', spec: '基础款', stock: 9, updatedAt: 1000 }])
    const stale = await setStock('p1', '基础款', 99, undefined, 999) // 管理员手里是过期版本
    expect(stale).toEqual({ ok: false, conflict: true })
    expect(control.dump('inventory')[0].stock).toBe(9) // 未被旧页面覆盖

    const fresh = await setStock('p1', '基础款', 99, undefined, 1000) // 版本相符
    expect(fresh.ok).toBe(true)
    expect(control.dump('inventory')[0].stock).toBe(99)

    const first = await setStock('pNew', '', 5) // 首设无条件写
    expect(first.ok).toBe(true)
    expect(control.dump('inventory').find((x: any) => x._id === 'pNew__').stock).toBe(5)
  })
})

describe('closeExpiredOrders（黄金：服务端专用·超时窗·回补幂等）', () => {
  it('大白话：客户端带身份调用一律拒不关单；服务端只关超窗待支付单并回补库存；再跑不重复回补', async () => {
    const old = Date.now() - 20 * 60 * 1000
    control.seed('orders', [
      {
        _id: 'oOld',
        id: 'oOld',
        _openid: 'oME',
        status: 'pending',
        createdAt: old,
        reserved: [{ productId: 'p1', spec: '基础款', qty: 2 }],
      },
      { _id: 'oNew', id: 'oNew', _openid: 'oME', status: 'pending', createdAt: Date.now(), reserved: [] },
      { _id: 'oPaid', id: 'oPaid', _openid: 'oME', status: 'paid', createdAt: old },
    ])
    control.seed('inventory', [{ _id: 'p1__基础款', productId: 'p1', spec: '基础款', stock: 3 }])

    control.setOpenId('oHACK')
    expect(((await closeExpired()) as any).closed).toBe(0) // 客户端拒
    expect(control.dump('orders').find((o: any) => o._id === 'oOld').status).toBe('pending')

    control.setOpenId('')
    const r: any = await closeExpired()
    expect(r.closed).toBe(1)
    const dump = control.dump('orders')
    expect(dump.find((o: any) => o._id === 'oOld').status).toBe('closed')
    expect(dump.find((o: any) => o._id === 'oNew').status).toBe('pending')
    expect(dump.find((o: any) => o._id === 'oPaid').status).toBe('paid')
    expect(control.dump('inventory')[0].stock).toBe(5) // 回补 2

    expect(((await closeExpired()) as any).closed).toBe(0) // 幂等：不重复回补
    expect(control.dump('inventory')[0].stock).toBe(5)
  })
})

describe('cancelOrder 用户主动取消待支付单（复用 pending→closed 边·回补幂等绑 CAS）', () => {
  const seedPending = () => {
    control.seed('orders', [
      { _id: 'oP', id: 'oP', _openid: 'oME', status: 'pending', createdAt: Date.now(), reserved: [{ productId: 'p1', spec: '基础款', qty: 2 }] },
      { _id: 'oPaid', id: 'oPaid', _openid: 'oME', status: 'paid', createdAt: Date.now(), reserved: [] },
    ])
    control.seed('inventory', [{ _id: 'p1__基础款', productId: 'p1', spec: '基础款', stock: 3 }])
  }

  it('大白话：本人取消待支付单→关闭并回补预留库存', async () => {
    seedPending()
    const r: any = await call('cancelOrder', { id: 'oP' })
    expect(r.ok).toBe(true)
    expect(control.dump('orders').find((o: any) => o._id === 'oP').status).toBe('closed')
    expect(control.dump('inventory')[0].stock).toBe(5) // 回补 2
  })

  it('大白话：未登录拒·缺单号拒·非本人表现为不存在（不动单不回补）', async () => {
    seedPending()
    control.setOpenId('')
    expect((await call('cancelOrder', { id: 'oP' })).error).toBe('NO_OPENID')
    control.setOpenId('oME')
    expect((await call('cancelOrder', {})).error).toBe('NO_ID')
    control.setOpenId('oHACK')
    expect((await call('cancelOrder', { id: 'oP' })).error).toBe('NOT_FOUND') // 属主隔离·不泄存在性
    control.setOpenId('oME')
    expect(control.dump('orders').find((o: any) => o._id === 'oP').status).toBe('pending')
    expect(control.dump('inventory')[0].stock).toBe(3) // 未回补
  })

  it('大白话：非待支付单（已付/已关）不可取消·BAD_STATUS·不动单不回补', async () => {
    seedPending()
    expect((await call('cancelOrder', { id: 'oPaid' })).error).toContain('BAD_STATUS')
    expect(control.dump('inventory')[0].stock).toBe(3)
  })

  it('大白话：并发双取消——只一个成功、只回补一次（CAS 幂等·与超时关单互斥）', async () => {
    seedPending()
    const [a, b] = await Promise.all([call('cancelOrder', { id: 'oP' }), call('cancelOrder', { id: 'oP' })])
    expect([a, b].filter((r: any) => r.ok).length).toBe(1) // 只一个翻转成功
    expect(control.dump('orders').find((o: any) => o._id === 'oP').status).toBe('closed')
    expect(control.dump('inventory')[0].stock).toBe(5) // 只回补一次·不虚高
  })
})

describe('getMyOrders 状态筛选（服务端·分页与过滤同源·修 order-list 短过滤 tab 拉不动死提示）', () => {
  it('大白话：传 status 只回本人该状态的单（他人不混入）；非法/空 status 回本人全部', async () => {
    control.setOpenId('oME')
    control.seed('orders', [
      { _id: 'o1', _openid: 'oME', status: 'done', createdAt: 10 },
      { _id: 'o2', _openid: 'oME', status: 'pending', createdAt: 20 },
      { _id: 'o3', _openid: 'oME', status: 'done', createdAt: 30 },
      { _id: 'o4', _openid: 'oOTHER', status: 'done', createdAt: 40 },
    ])
    const done: any = await call('getMyOrders', { status: 'done' })
    expect(done.list.map((o: any) => o._id).sort()).toEqual(['o1', 'o3']) // 只本人 done·他人 o4 不混入
    expect(((await call('getMyOrders', { status: 'not-a-status' })) as any).list.length).toBe(3) // 非法 status 忽略·回本人全部
    expect(((await call('getMyOrders', {})) as any).list.length).toBe(3) // 空 status 回全部
  })
})

// ── 批C·订单读时换址（根因#15 图片面·批B getProducts/getContent 换址同口径的订单面延伸）：
// 订单行 items[].cover 库内存 cloud:// 裸 fileID（下单时从 products.cover 快照进订单，见 orders.ts
// createOrder 注释），getMyOrders/getOrderById 下发前应同 catalog.ts 口径批量换 https 短时址——
// 库内快照本身不动（订单=历史快照单源·T3，不回读/不改写 catalog），只在下发响应前转换，换址失败
// 该行回退原 fileID（fail-soft，不吞整单/整个响应）。消费面见 rewrite/mp/lib/mapOrders.ts 的
// OrderLineVM.cover（itemsOf() 直接读 it.cover）。以下为先立的红测试（现状未转换·预期先红）。
//
// getMyAfterSales 消费面见 rewrite/mp/lib/mapAftersales.ts 的 AfterSaleVM：已核过全部字段
// （id/orderId/lineId/name/spec/qty/refundAmount/status/appliedAt/reason），无任何图/封面字段；
// 云端 applyRefund 落库的 rec（orders.ts:324-342）本身也不含 cover。故本批不为 getMyAfterSales
// 写换址测试——消费面确认无图字段，不是漏写。
describe('getMyOrders / getOrderById（订单行 cover 换临时地址·批C 图片提速延伸·预期先红）', () => {
  const seedOrder = (id: string, items: any[]) =>
    control.seed('orders', [{ _id: id, id, _openid: 'oME', status: 'paid', createdAt: 10, items }])

  it('大白话：cloud:// 封面换成 https 短时址（getMyOrders 列表与 getOrderById 详情同口径）', async () => {
    seedOrder('o1', [
      { productId: 'p1', lineId: 'p1__', name: '小鸭礼盒', spec: '', price: 198, qty: 1, cover: 'cloud://o1-cover.jpg' },
    ])
    const list: any = await call('getMyOrders')
    expect(list.list[0].items[0].cover).toBe('https://tmp/cloud://o1-cover.jpg')

    const one: any = await call('getOrderById', { id: 'o1' })
    expect(one.order.items[0].cover).toBe('https://tmp/cloud://o1-cover.jpg')
  })

  it('大白话：已是 https / 空串（搭配购无封面）原样透传，不炸也不误加前缀', async () => {
    seedOrder('o2', [
      { productId: 'p1', lineId: 'p1__', name: 'A', spec: '', price: 10, qty: 1, cover: 'https://cdn.example.com/x.jpg' },
      { productId: 'hook', lineId: 'hook__', name: '钩针', spec: '', price: 5, qty: 1, cover: '' },
    ])
    const list: any = await call('getMyOrders')
    const items = list.list[0].items
    expect(items[0].cover).toBe('https://cdn.example.com/x.jpg') // 已是 https → 原样，不叠加 tmp 前缀
    expect(items[1].cover).toBe('') // 空串原样透传，不炸

    const one: any = await call('getOrderById', { id: 'o2' })
    expect(one.order.items[0].cover).toBe('https://cdn.example.com/x.jpg')
    expect(one.order.items[1].cover).toBe('')
  })

  it('大白话：换址失败（storage 桩返回缺项）该行回退原 fileID，不吞整单/整个响应（fail-soft 读路径）', async () => {
    vi.spyOn(cloud, 'getTempFileURL').mockImplementation(async ({ fileList }: any) => ({
      fileList: fileList
        .filter((id: string) => id !== 'cloud://bad.jpg')
        .map((id: string) => ({ fileID: id, tempFileURL: 'https://tmp/' + id })),
    }))
    seedOrder('o3', [
      { productId: 'p1', lineId: 'p1__', name: 'A', spec: '', price: 10, qty: 1, cover: 'cloud://bad.jpg' },
      { productId: 'p2', lineId: 'p2__', name: 'B', spec: '', price: 10, qty: 1, cover: 'cloud://good.jpg' },
    ])

    const list: any = await call('getMyOrders')
    expect(list.ok).toBe(true) // 整个响应不因单项换址失败而炸
    expect(list.list[0].items[0].cover).toBe('cloud://bad.jpg') // 换不到 → 回退原 fileID（不是空串/null）
    expect(list.list[0].items[1].cover).toBe('https://tmp/cloud://good.jpg') // 正常换到的项不受影响

    const one: any = await call('getOrderById', { id: 'o3' })
    expect(one.ok).toBe(true)
    expect(one.order.items[0].cover).toBe('cloud://bad.jpg')
    expect(one.order.items[1].cover).toBe('https://tmp/cloud://good.jpg')
  })
})

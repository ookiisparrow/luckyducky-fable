// 交易页显示钱的节点：WXML 绑定的字段对不对。Page 桩测试不渲染 WXML，绑错字段（比如结算页「实付款」
// 把 {{amountNum}} 写成 {{amountFen}}）测试和守卫都是绿的，真机才露馅。这里读 wxml 找到金额节点，把它的文字
// 连同 {{字段路径}} 在 Page 桩跑出的 data 上拼出来，和期望金额比。只认简单字段路径——金额节点里写表达式就直接红，逼着改成页面算好再绑。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import checkoutWxml from '../pages/checkout/checkout.wxml?raw'
import orderWxml from '../pages/order/order.wxml?raw'
import orderListWxml from '../pages/order-list/order-list.wxml?raw'
import paysuccessWxml from '../pages/paysuccess/paysuccess.wxml?raw'

const { callAppMock } = vi.hoisted(() => ({ callAppMock: vi.fn() }))
vi.mock('../utils/cloud', () => ({ callApp: callAppMock }))
vi.mock('../lib/haptics', () => ({ tapHaptic: vi.fn() }))
vi.mock('../lib/homeIntent', () => ({ goHomeTab: vi.fn() }))
// 线上搭配购全是占位（不渲染），补一个能卖的，好测搭配购单价节点
vi.mock('../lib/checkoutConst', async (orig) => {
  const m = await orig<typeof import('../lib/checkoutConst')>()
  return { ...m, CHECKOUT_ADDONS: [...m.CHECKOUT_ADDONS, { id: 'kit', name: '工具包', price: 19.9 }] }
})

function evalPath(expr: string, scope: Record<string, any>): unknown {
  if (!/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(expr)) throw new Error('金额节点绑定不是简单字段路径：' + expr)
  return expr.split('.').reduce<any>((o, k) => (o == null ? undefined : o[k]), scope)
}

/** 第 nth 个 class 含 cls 的元素：剥掉内部标签后的上屏文字（{{路径}} 按 scope 求值）。 */
function nodeText(wxml: string, cls: string, scope: Record<string, any>, nth = 0): string {
  const src = wxml.replace(/<!--[\s\S]*?-->/g, '')
  const open = /<([a-z-]+)\b[^>]*\sclass="([^"]*)"[^>]*>/g
  let hit = -1
  for (let m = open.exec(src); m; m = open.exec(src)) {
    if (!m[2].split(/\s+/).includes(cls) || ++hit < nth) continue
    const tags = new RegExp(`<(/?)${m[1]}\\b[^>]*?(/?)>`, 'g')
    tags.lastIndex = open.lastIndex
    let depth = 1
    let t: RegExpExecArray | null = null
    while (depth && (t = tags.exec(src))) depth += t[1] ? -1 : t[2] ? 0 : 1
    if (!t) throw new Error(`${cls} 节点没闭合`)
    return src
      .slice(open.lastIndex, t.index)
      .replace(/<[^>]+>/g, '')
      .replace(/\{\{\s*([^}]*?)\s*\}\}/g, (_, e: string) => String(evalPath(e, scope)))
      .replace(/\s+/g, ' ')
      .trim()
  }
  throw new Error(`wxml 里找不到第 ${nth + 1} 个 class 含 ${cls} 的节点`)
}

let pageOpts: Record<string, any> = {}
;(globalThis as any).Page = (o: unknown) => {
  pageOpts = o as Record<string, any>
}
async function mount(path: string): Promise<Record<string, any>> {
  await import(path)
  const page = Object.create(pageOpts) as Record<string, any>
  page.data = { ...pageOpts.data }
  page._all = []
  page.setData = function (patch: Record<string, unknown>) {
    for (const [k, v] of Object.entries(patch)) {
      const m = k.match(/^(\w+)\[(\d+)\]$/)
      if (m) (this.data as any)[m[1]][Number(m[2])] = v
      else (this.data as any)[k] = v
    }
  }
  return page
}

const ORDER = (over: Record<string, unknown> = {}) => ({
  _id: 'o1',
  status: 'paid',
  amount: 162,
  goods: 150,
  ship: 12,
  items: [
    { lineId: 'L1', name: '小鸭', price: 64, qty: 2 },
    { lineId: 'L2', name: '云朵鸭', price: 22, qty: 1 },
  ],
  ...over,
})
let handlers: Record<string, (data: Record<string, any>) => unknown>
let storage: Record<string, unknown>

beforeEach(() => {
  vi.resetModules()
  storage = {}
  handlers = {
    trackEvent: () => ({ ok: true }),
    getProducts: () => ({ ok: true, list: [] }),
    getOrderById: () => ({ ok: true, order: ORDER() }),
    getMyOrders: () => ({ ok: true, list: [ORDER()], nextCursor: null, hasMore: false }),
  }
  callAppMock.mockReset().mockImplementation(async (action: string, data: Record<string, any>) =>
    handlers[action] ? handlers[action](data) : { ok: false, error: 'UNEXPECTED' }
  )
  ;(globalThis as any).wx = {
    getStorageSync: (k: string) => storage[k],
    setStorageSync: (k: string, v: unknown) => (storage[k] = JSON.parse(JSON.stringify(v))),
    showToast: vi.fn(),
    showModal: vi.fn(),
  }
})

describe('交易页金额节点绑对了字段', () => {
  it('大白话：结算页——「实付款」行与底坞合计都显示应付总额，条目显示单价', async () => {
    const cart = await import('../lib/cart')
    cart.add({ id: 'p1', name: '小鸭', price: 128 })
    cart.add({ id: 'p1', name: '小鸭', price: 128 })
    cart.add({ id: 'p2', name: '云朵鸭', price: 22 })
    ;(await import('../lib/checkout')).prepareFromCart()
    const page = await mount('../pages/checkout/checkout')
    await page.refresh()
    const d = page.data
    expect(nodeText(checkoutWxml, 'total', d)).toBe('实付款 ¥278.00')
    expect(nodeText(checkoutWxml, 'co-dock-num', d)).toBe('¥278.00')
    expect(nodeText(checkoutWxml, 'co-item-price', { ...d, item: d.items[0] })).toBe('¥128.00')
    expect(nodeText(checkoutWxml, 'co-sum-v', d, 0)).toBe('¥278.00') // 商品金额
  })

  it('大白话：结算页——勾上搭配购，搭配购那行显示它的单价、合计跟着加上', async () => {
    const cart = await import('../lib/cart')
    cart.add({ id: 'p1', name: '小鸭', price: 128 })
    ;(await import('../lib/checkout')).prepareFromCart()
    const page = await mount('../pages/checkout/checkout')
    page.onToggleAddon({ currentTarget: { dataset: { id: 'kit' } } })
    await vi.waitFor(() => expect(page.data.count).toBe(2))
    const d = page.data
    expect(nodeText(checkoutWxml, 'co-addon-price', { ...d, item: d.addons[0] })).toBe('¥19.90')
    expect(nodeText(checkoutWxml, 'total', d)).toBe('实付款 ¥147.90')
  })

  it('大白话：结算页——云端报回现价应付后，「实付款」和底坞显示云端的数，商品金额仍是本地逐行合计', async () => {
    const cart = await import('../lib/cart')
    cart.add({ id: 'p1', name: '小鸭', price: 128 })
    cart.add({ id: 'p1', name: '小鸭', price: 128 })
    cart.add({ id: 'p2', name: '云朵鸭', price: 22 })
    const ck = await import('../lib/checkout')
    ck.prepareFromCart()
    ck.quoteAmountFen(35000)
    const page = await mount('../pages/checkout/checkout')
    await page.refresh()
    const d = page.data
    expect(nodeText(checkoutWxml, 'total', d)).toBe('实付款 ¥350.00')
    expect(nodeText(checkoutWxml, 'co-dock-num', d)).toBe('¥350.00')
    expect(nodeText(checkoutWxml, 'co-sum-v', d, 0)).toBe('¥278.00')
  })

  it('大白话：订单详情——金额明细与底坞都显示实付，商品金额与运费各显示各的，条目显示单价；支付异常单显示实际到账而不是标价', async () => {
    let page = await mount('../pages/order/order')
    page.onLoad({ id: 'o1' })
    await page.reload()
    expect(nodeText(orderWxml, 'total', page.data)).toBe('实付款¥162.00')
    expect(nodeText(orderWxml, 'co-dock-num', page.data)).toBe('¥162.00')
    expect(nodeText(orderWxml, 'co-sum-v', page.data, 0)).toBe('¥150.00') // 商品金额
    expect(nodeText(orderWxml, 'co-sum-v', page.data, 1)).toBe('¥12.00') // 运费
    expect(nodeText(orderWxml, 'co-item-price', { ...page.data, item: page.data.vm.items[0] })).toBe('¥64.00')

    handlers.getOrderById = () => ({ ok: true, order: ORDER({ status: 'payment_exception', paidFee: 10000 }) })
    vi.resetModules()
    page = await mount('../pages/order/order')
    page.onLoad({ id: 'o1' })
    await page.reload()
    expect(nodeText(orderWxml, 'total', page.data)).toBe('实付款¥100.00')
    expect(nodeText(orderWxml, 'co-dock-num', page.data)).toBe('¥100.00')
  })

  it('大白话：订单列表——每单底行显示实付合计，商品行显示单价', async () => {
    const page = await mount('../pages/order-list/order-list')
    page.onLoad({})
    await page.reload()
    const item = page.data.shown[0]
    expect(nodeText(orderListWxml, 'coolist-sum', { ...page.data, item })).toBe('共 3 件 · 实付款¥162.00')
    expect(nodeText(orderListWxml, 'coolist-price', { ...page.data, item, line: item.items[1] })).toBe('¥22.00')
  })

  it('大白话：支付成功页——显示透传过来的实付（分转元）', async () => {
    const page = await mount('../pages/paysuccess/paysuccess')
    page.onLoad({ id: 'o1', amount: '27800' })
    expect(nodeText(paysuccessWxml, 'ld-ps-amount', page.data)).toBe('¥278.00')
  })

  it('大白话：取数器本身——绑了不存在的字段拼出 undefined，金额节点写表达式直接报错', () => {
    expect(nodeText('<text class="x"><text class="cny">¥</text>{{amountFen}}</text>', 'x', { amountNum: '1.00' })).toBe('¥undefined')
    expect(() => nodeText('<text class="x">{{a ? b : c}}</text>', 'x', {})).toThrow('简单字段路径')
  })
})

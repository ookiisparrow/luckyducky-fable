// @vitest-environment happy-dom
// 后台 12 处「加载更多」同一套行为，逐页挂真组件点按钮验：接着游标往后翻、到底就停、在途连点只发一次、
// 翻页失败留住已有行并给中文原因（再点用同一游标重试）、重开/切筛选后旧的翻页回包不混进新列表、
// 翻页在途时重开后新列表照常能翻、旧页晚回来不放开新翻页的连点闸、重开在途时不拿旧游标翻页。
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { transportErrorText } from '../src/lib/mapSystem'

const api = vi.hoisted(() => {
  const fns = (names: string[]) => Object.fromEntries(names.map((n) => [n, vi.fn()])) as Record<string, Mock>
  return {
    money: fns(['listOrders', 'orderCounts', 'getOrderDetail', 'shipOrder', 'shipOrders', 'clearFeeMismatch', 'recordPaidFee', 'listRefunds', 'refundCounts', 'approveRefund', 'rejectRefund', 'getRefundDetail', 'overrideRefund']),
    reviews: fns(['listReviews', 'setReviewPicked']),
    cs: fns(['getCsatReport', 'listCsatEntries', 'searchConversations', 'conversationsReport', 'sampleQc', 'saveQcMark', 'listQcSampled', 'getTrialRefreshGate', 'refreshTrialSession']),
    ops: fns(['listAudit']),
    scm: fns([
      'listPurchases', 'savePurchase', 'markOrdered', 'receivePurchase', 'cancelPurchase',
      'listOutworks', 'saveOutwork', 'issueOutwork', 'receiveOutwork', 'settleOutwork', 'cancelOutwork',
      'listMaterials', 'saveMaterial', 'listSuppliers', 'saveSupplier', 'adjustStock', 'listLedger',
      'getBomSetup', 'saveBomTemplate', 'saveBomProfile', 'previewAssembly', 'runAssembly', 'listAssemblies',
    ]),
    products: fns(['listDrafts']),
  }
})
vi.mock('../src/api/money', () => api.money)
vi.mock('../src/api/reviews', () => api.reviews)
vi.mock('../src/api/cs', () => api.cs)
vi.mock('../src/api/ops', () => api.ops)
vi.mock('../src/api/scm', () => api.scm)
vi.mock('../src/api/products', () => api.products)
vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }), useRouter: () => ({ push: vi.fn() }) }))

import Orders from '../src/pages/Orders.vue'
import Refunds from '../src/pages/Refunds.vue'
import Reviews from '../src/pages/Reviews.vue'
import Csat from '../src/pages/Csat.vue'
import Audit from '../src/pages/Audit.vue'
import Conversations from '../src/pages/Conversations.vue'
import ScmPurchase from '../src/pages/ScmPurchase.vue'
import ScmOutwork from '../src/pages/ScmOutwork.vue'
import ScmMaterials from '../src/pages/ScmMaterials.vue'
import ScmBom from '../src/pages/ScmBom.vue'
import { pending } from './helpers/pending'

type W = VueWrapper
interface Case {
  name: string
  page: unknown
  list: Mock
  key: 'list' | 'entries' | 'messages' // 回包里行数组的字段名（照云端各 action）
  row: (id: string) => Record<string, unknown>
  cursorOf: (args: unknown[]) => unknown
  ids: (w: W) => string[]
  err: string // 翻页失败提示的开头
  clearsErr?: boolean // 重试成功后提示会消失
  moreText?: string
  moreIn?: (b: W['element']) => boolean
  start?: (w: W) => Promise<unknown>
  reopen?: (w: W) => Promise<unknown>
}

const click = (w: W, text: string) => w.findAll('button').find((b) => b.text() === text)!.trigger('click')
const chip = (w: W, text: string) => w.findAll('button.ld-chip').find((b) => b.text().startsWith(text))!.trigger('click')
const texts = (w: W, sel: string) => w.findAll(sel).map((e) => e.text())
const argCursor = (i: number) => (args: unknown[]) => (args[i] as { cursor?: unknown } | undefined)?.cursor

const CASES: Case[] = [
  {
    name: 'Orders 订单',
    page: Orders,
    list: api.money.listOrders,
    key: 'list',
    row: (id) => ({ id, status: 'paid', items: [{ productId: 'p', name: '材料包', qty: 1 }], amount: 99, createdAt: 1 }),
    cursorOf: (a) => a[1],
    ids: (w) => texts(w, '.ld-tbody .oid'),
    err: '加载更多失败',
    clearsErr: true,
    reopen: (w) => chip(w, '已发货'),
  },
  {
    name: 'Refunds 售后',
    page: Refunds,
    list: api.money.listRefunds,
    key: 'list',
    row: (id) => ({ _id: id, orderId: id, status: 'applied', name: '材料包', qty: 1, refundAmount: 99, appliedAt: 1 }),
    cursorOf: (a) => a[1],
    ids: (w) => texts(w, '.ld-tbody .oid'),
    err: '加载更多失败',
    clearsErr: true,
    reopen: (w) => chip(w, '已拒绝'),
  },
  {
    name: 'Reviews 评价',
    page: Reviews,
    list: api.reviews.listReviews,
    key: 'list',
    row: (id) => ({ id, productId: 'p1', name: '鸭友', rating: 5, tags: [], text: id, spec: '', createdAt: 1, photos: [], picked: false }),
    cursorOf: argCursor(0),
    ids: (w) => texts(w, '.ld-tbody .body'),
    err: '加载更多失败',
    reopen: (w) => click(w, '已上架'),
  },
  {
    name: 'Csat 评价明细',
    page: Csat,
    list: api.cs.listCsatEntries,
    key: 'entries',
    row: (id) => ({ id, at: 1, score: 5, note: id, externalUserId: '' }),
    cursorOf: argCursor(0),
    ids: (w) => texts(w, '.ld-tbody .ld-td.grow'),
    err: '加载更多失败',
    clearsErr: true,
    reopen: (w) => click(w, '近 30 天'),
  },
  {
    name: 'Audit 审计',
    page: Audit,
    list: api.ops.listAudit,
    key: 'entries',
    row: (id) => ({ id, action: id, operator: 'boss', ip: '1.2.3.4', ok: true, error: '', summary: {}, ts: 1 }),
    cursorOf: argCursor(0),
    ids: (w) => w.findAll('.ld-tbody .ld-tr').map((r) => r.findAll('.ld-td')[2].text()),
    err: '加载更多失败',
    clearsErr: true,
    reopen: (w) => click(w, '近 30 天'),
  },
  {
    name: 'Conversations 会话时间轴',
    page: Conversations,
    list: api.cs.searchConversations,
    key: 'messages',
    row: (id) => ({ id, direction: 'in', text: id, at: 1 }),
    cursorOf: argCursor(0),
    ids: (w) => texts(w, '.timeline .text'),
    err: '加载更多失败',
    clearsErr: true,
    moreText: '更早的消息',
    start: (w) => click(w, '检索'),
    reopen: (w) => click(w, '检索'),
  },
  {
    // 抽样列表只在进页时取一次首页，没有重开入口
    name: 'Conversations 质检抽样',
    page: Conversations,
    list: api.cs.listQcSampled,
    key: 'list',
    row: (id) => ({ sessionKey: 'k-' + id, externalUserId: id, qcSampledAt: 1, qc: null }),
    cursorOf: argCursor(0),
    ids: (w) => w.findAll('.ld-tbody .ld-tr').map((r) => r.find('.ld-td').text()),
    err: '加载更多失败',
    clearsErr: true,
  },
  {
    name: 'ScmPurchase 采购单',
    page: ScmPurchase,
    list: api.scm.listPurchases,
    key: 'list',
    row: (id) => ({ _id: id, supplierId: 's1', status: 'received', lines: [], totalFen: 0, createdAt: 1 }),
    cursorOf: argCursor(1),
    ids: (w) => texts(w, '.ld-tbody .oid'),
    err: '加载更多失败',
    reopen: (w) => chip(w, '草稿'),
  },
  {
    name: 'ScmOutwork 外协单',
    page: ScmOutwork,
    list: api.scm.listOutworks,
    key: 'list',
    row: (id) => ({ _id: id, status: 'draft', issueLines: [] }),
    cursorOf: argCursor(1),
    ids: (w) => texts(w, '.ld-tbody .ld-td.grow .mono'),
    err: '加载更多失败',
    reopen: async (w) => {
      await click(w, '取消')
      await click(w, '确认取消？') // 动作成功后整页 reload
    },
  },
  {
    name: 'ScmMaterials 流水',
    page: ScmMaterials,
    list: api.scm.listLedger,
    key: 'list',
    row: (id) => ({ _id: id, itemKey: 'tool:hook', delta: 1, docType: 'adjust', docId: 'd', operator: 'a', reason: 'R-' + id, at: 1 }),
    cursorOf: argCursor(1),
    ids: (w) => texts(w, '.ld-td').filter((t) => t.startsWith('R-')).map((t) => t.slice(2)),
    err: '加载更多流水失败',
    moreIn: (b) => !b.closest('.sup-list'),
    reopen: (w) => click(w, '流水'), // 换看某个料的流水
  },
  {
    name: 'ScmMaterials 供应商',
    page: ScmMaterials,
    list: api.scm.listSuppliers,
    key: 'list',
    row: (id) => ({ _id: id, name: id, type: 'factory' }),
    cursorOf: argCursor(0),
    ids: (w) => texts(w, '.sup-list .sup-name'),
    err: '加载更多供应商失败',
    moreIn: (b) => !!b.closest('.sup-list'),
    reopen: (w) => click(w, '建档 / 更新'), // 建档成功后整页 reload
  },
  {
    name: 'ScmBom 组装记录',
    page: ScmBom,
    list: api.scm.listAssemblies,
    key: 'list',
    row: (id) => ({ _id: id, productId: 'p1', spec: '', sets: 1, operator: 'a', at: 1, consumedLines: [] }),
    cursorOf: argCursor(0),
    ids: (w) => texts(w, '.ld-tbody .ld-td.grow.mono'),
    err: '加载更多组装记录失败',
    reopen: (w) => click(w, '保存差异位'), // 保存成功后整页 reload
  },
]

const NET = { ok: false, status: 0, error: 'NETWORK:Failed to fetch' }
const netText = transportErrorText(NET.error)

beforeEach(() => {
  for (const group of Object.values(api)) for (const f of Object.values(group)) f.mockReset().mockResolvedValue({ ok: true, list: [], entries: [], messages: [], nextCursor: null, hasMore: false })
  api.money.orderCounts.mockResolvedValue({ ok: true, counts: {} })
  api.money.refundCounts.mockResolvedValue({ ok: true, counts: {} })
  api.cs.getCsatReport.mockResolvedValue({ ok: true, total: 0, avg: 0, dist: {}, withNote: 0 })
  api.cs.conversationsReport.mockResolvedValue({ ok: false, error: 'X' })
  api.cs.getTrialRefreshGate.mockResolvedValue({ ok: true, enabled: false })
  api.scm.listMaterials.mockResolvedValue({ ok: true, list: [{ _id: 'tool:hook', category: 'tool', uom: 'count', stock: 1 }] })
  api.scm.getBomSetup.mockResolvedValue({ ok: true, template: { commonLines: [], yarnSlots: [] }, profiles: [] })
})

describe.each(CASES)('$name 加载更多', (c) => {
  const page = (ids: string[], nextCursor: unknown, hasMore: boolean) => ({ ok: true, [c.key]: ids.map(c.row), nextCursor, hasMore })
  const moreCursors = () => c.list.mock.calls.map(c.cursorOf).filter((x) => x != null)
  const moreBtn = (w: W) => w.findAll('button').find((b) => b.text() === (c.moreText || '加载更多') && (!c.moreIn || c.moreIn(b.element)))
  const open = async () => {
    const w = mount(c.page as never, { global: { stubs: { ScmFlowTabs: true } } })
    await flushPromises()
    if (c.start) {
      await c.start(w)
      await flushPromises()
    }
    return w
  }

  it('大白话：点加载更多接着上一页的游标取，新行接在后面，上一页已有的不重复出现', async () => {
    c.list.mockResolvedValueOnce(page(['a', 'b'], 'c1', true)).mockResolvedValueOnce(page(['b', 'c'], 'c2', true))
    const w = await open()
    await moreBtn(w)!.trigger('click')
    await flushPromises()
    expect(moreCursors()).toEqual(['c1'])
    expect(c.ids(w)).toEqual(['a', 'b', 'c'])
    expect(moreBtn(w)).toBeTruthy()
  })

  it('大白话：翻到底就不再显「加载更多」；说还有却没给游标也不去翻（空游标会从头再取一遍）', async () => {
    c.list.mockResolvedValueOnce(page(['a'], 'c1', true)).mockResolvedValueOnce(page(['b'], null, false))
    const w = await open()
    await moreBtn(w)!.trigger('click')
    await flushPromises()
    expect(c.ids(w)).toEqual(['a', 'b'])
    expect(moreBtn(w)).toBeUndefined()

    c.list.mockReset().mockResolvedValue(page(['a'], null, true))
    const w2 = await open()
    const calls = c.list.mock.calls.length
    await moreBtn(w2)?.trigger('click')
    await flushPromises()
    expect(c.list.mock.calls.length).toBe(calls)
  })

  it('大白话：上一页还没回来时连点，只发一次请求', async () => {
    const p = pending()
    c.list.mockResolvedValueOnce(page(['a'], 'c1', true)).mockReturnValueOnce(p.p)
    const w = await open()
    await moreBtn(w)!.trigger('click')
    await moreBtn(w)!.trigger('click')
    expect(moreCursors()).toEqual(['c1'])
    p.release(page(['b'], 'c2', true))
    await flushPromises()
    expect(c.ids(w)).toEqual(['a', 'b'])
    await moreBtn(w)!.trigger('click')
    expect(moreCursors()).toEqual(['c1', 'c2']) // 回来后照常能接着翻
  })

  it('大白话：翻页失败——已有行不动、给中文原因不甩裸码、按钮还在，再点用同一游标重试', async () => {
    c.list.mockResolvedValueOnce(page(['a', 'b'], 'c1', true)).mockResolvedValueOnce(NET).mockResolvedValueOnce(page(['c'], null, false))
    const w = await open()
    await moreBtn(w)!.trigger('click')
    await flushPromises()
    expect(w.text()).toContain(c.err + '：' + netText)
    expect(w.text()).not.toContain('NETWORK:')
    expect(c.ids(w)).toEqual(['a', 'b'])

    await moreBtn(w)!.trigger('click')
    await flushPromises()
    expect(moreCursors()).toEqual(['c1', 'c1'])
    expect(c.ids(w)).toEqual(['a', 'b', 'c'])
    if (c.clearsErr) expect(w.text()).not.toContain(c.err)
  })

  const reopen = c.reopen
  if (!reopen) return

  it('大白话：翻页在途时重开/切了筛选，旧页晚回来也不混进新列表、不改翻页位置', async () => {
    const p = pending()
    c.list.mockResolvedValueOnce(page(['a'], 'c1', true)).mockReturnValueOnce(p.p).mockResolvedValueOnce(page(['x'], null, false))
    const w = await open()
    await moreBtn(w)!.trigger('click')
    await reopen(w)
    await flushPromises()
    expect(c.ids(w)).toEqual(['x'])
    p.release(page(['b'], 'c2', true))
    await flushPromises()
    expect(c.ids(w)).toEqual(['x'])
    expect(moreBtn(w)).toBeUndefined()
  })

  it('大白话：翻页在途时重开，新列表照常能翻；旧页晚回来也不放开新翻页的连点闸', async () => {
    const [old, cur] = [pending(), pending()]
    c.list.mockResolvedValueOnce(page(['a'], 'c1', true)).mockReturnValueOnce(old.p).mockResolvedValueOnce(page(['x'], 'c9', true)).mockReturnValueOnce(cur.p)
    const w = await open()
    await moreBtn(w)!.trigger('click')
    await reopen(w)
    await flushPromises()
    await moreBtn(w)!.trigger('click') // 旧翻页还挂着，不该挡新列表翻页
    expect(moreCursors()).toEqual(['c1', 'c9'])
    old.release(page(['b'], 'c2', true))
    await flushPromises()
    await moreBtn(w)!.trigger('click') // c9 还没回来，仍算在途
    expect(moreCursors()).toEqual(['c1', 'c9'])
    cur.release(page(['y'], null, false))
    await flushPromises()
    expect(c.ids(w)).toEqual(['x', 'y'])
    expect(moreBtn(w)).toBeUndefined()
  })

  it('大白话：重开/切筛选还没回来时点加载更多不发（游标还是上一次查询的，发了会串档）', async () => {
    const p = pending()
    c.list.mockResolvedValueOnce(page(['a'], 'c1', true)).mockReturnValueOnce(p.p)
    const w = await open()
    await reopen(w)
    await flushPromises()
    await moreBtn(w)?.trigger('click')
    await flushPromises()
    expect(moreCursors()).toEqual([])
    p.release(page(['x'], 'c9', true))
    await flushPromises()
    expect(c.ids(w)).toEqual(['x'])
    await moreBtn(w)!.trigger('click')
    expect(moreCursors()).toEqual(['c9'])
  })
})

// 黄金 观测-巡检 §B：巡检机「主动核对不变量·探出静默失败」（守卫 rw-inspect-golden）。
// 不依赖 AI 的定时/手动体检：跑一遍检查目录（A 基建存活 + B 业务不变量）→ 写 inspectRuns 体检报告
// → 每条红自动落 recordAnomaly（违反→bug 账本闭环）。只读——绝不改业务集合（「现在只读看护线上」铁律）。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { control } from 'wx-server-sdk'
import { runInspection, sendDailyHeartbeat } from '../src/kit'
import { COLLECTIONS, refundShareFen, toFen, asFen, fenToYuan } from '@ldrw/shared'

const HOUR = 3600 * 1000
const WEBHOOK = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc-1234'

beforeEach(() => control.reset())

describe('runInspection（巡检机·探出静默失败）', () => {
  it('大白话：干净数据→全绿·不落异常·写一条巡检史', async () => {
    control.seed(COLLECTIONS.config, [{ _id: 'x', v: 1 }])
    control.seed(COLLECTIONS.orders, [{ _id: 'A', status: 'done', amount: 100, paidAt: 111 }])
    const run = await runInspection('manual')
    expect(run.summary.red).toBe(0)
    expect(run.trigger).toBe('manual')
    expect(control.dump(COLLECTIONS.inspectRuns).length).toBe(1)
    expect(control.dump(COLLECTIONS.anomalies).length).toBe(0)
  })

  it('大白话：退款超实付→钱守恒红 + 落一条高危 anomaly（违反→账本闭环）', async () => {
    control.seed(COLLECTIONS.orders, [{ _id: 'A', status: 'paid', amount: 100, paidAt: Date.now() }])
    control.seed(COLLECTIONS.afterSales, [
      { _id: 'A__l1', orderId: 'A', status: 'refunded', refundAmount: 80 },
      { _id: 'A__l2', orderId: 'A', status: 'refunded', refundAmount: 50 }, // 80+50=130 > 100 实付
    ])
    const run = await runInspection('timer')
    const money = run.results.find((r) => r.id === 'money-conserved')!
    expect(money.status).toBe('red')
    expect(money.samples).toContain('A')
    const an = control.dump(COLLECTIONS.anomalies)
    expect(an.length).toBe(1)
    expect(an[0].severity).toBe('high')
  })

  it('大白话：钱守恒批量读订单（_.in 分块·不再逐 doc N+1）——120 单仍精准逮超退·零逐条 get', async () => {
    const orders: any[] = []
    const afterSales: any[] = []
    for (let i = 0; i < 120; i++) {
      orders.push({ _id: 'O' + i, status: 'done', amount: 100 })
      afterSales.push({ _id: 'AS' + i, orderId: 'O' + i, status: 'refunded', refundAmount: i === 77 ? 130 : 50 })
    }
    control.seed(COLLECTIONS.orders, orders)
    control.seed(COLLECTIONS.afterSales, afterSales)
    let docGets = 0 // beforeGet 收 {coll,id} 者=DocRef.get（逐条）；{coll,filter} 者=Query.get（批量）
    control.setBeforeGet(({ coll, id }: any) => {
      if (coll === COLLECTIONS.orders && id != null) docGets++
    })
    const run = await runInspection('timer')
    const money = run.results.find((r) => r.id === 'money-conserved')!
    expect(money.status).toBe('red')
    expect(money.samples).toContain('O77') // 超退单精准逮到（判定与逐条 get 版一致）
    expect(docGets).toBe(0) // N+1 消除：批量 _.in 读·零逐条 doc get
  })

  it('大白话：退款单对应订单缺失→不误报（与逐条 get 落空跳过语义一致）', async () => {
    control.seed(COLLECTIONS.afterSales, [{ _id: 'AS', orderId: 'GONE', status: 'refunded', refundAmount: 999 }])
    const run = await runInspection('timer')
    expect(run.results.find((r) => r.id === 'money-conserved')!.status).toBe('green') // 订单缺失→跳过·不判超退
  })

  it('大白话：付款超 72h 未发货→卡单红', async () => {
    control.seed(COLLECTIONS.orders, [{ _id: 'A', status: 'paid', amount: 100, transactionId: 'wxA', paidAt: Date.now() - 80 * HOUR }])
    const run = await runInspection('timer')
    const stuck = run.results.find((r) => r.id === 'stuck-order')!
    expect(stuck.status).toBe('red')
    expect(stuck.samples).toContain('A')
  })

  it('大白话：mock 单（无真微信 transactionId=演示/非真钱）不算卡单——只报真付款', async () => {
    control.seed(COLLECTIONS.orders, [{ _id: 'M', status: 'paid', amount: 100, paidAt: Date.now() - 80 * HOUR }]) // 无 transactionId=mock/演示
    const run = await runInspection('timer')
    expect(run.results.find((r) => r.id === 'stuck-order')!.status).toBe('green')
  })

  it('大白话：真付款但正在退款（有活跃售后）不算卡单——不是发货义务', async () => {
    control.seed(COLLECTIONS.orders, [{ _id: 'R', status: 'paid', amount: 100, transactionId: 'wxR', paidAt: Date.now() - 80 * HOUR }])
    control.seed(COLLECTIONS.afterSales, [{ _id: 'R__l1', orderId: 'R', status: 'approved', refundAmount: 100 }])
    const run = await runInspection('timer')
    expect(run.results.find((r) => r.id === 'stuck-order')!.status).toBe('green')
  })

  it('大白话：refund_required 死信单（钱已收待人工退款没人管）→卡单红+高危告警', async () => {
    control.seed(COLLECTIONS.orders, [{ _id: 'D', status: 'refund_required', amount: 100, paidAt: Date.now() }])
    const run = await runInspection('timer')
    const stuck = run.results.find((r) => r.id === 'stuck-order')!
    expect(stuck.status).toBe('red')
    expect(stuck.samples).toContain('D')
    expect(control.dump(COLLECTIONS.anomalies).some((a: any) => a.severity === 'high')).toBe(true)
  })

  // 批K K2：放行 overrideRefund 后，退清的 refund_required 单**订单状态不变**（refundCallback 只回补库存 +
  // 写对账痕，从不改 order.status），若判据还停在「状态即死信」，退清的单会被永久报死信淹没真死信。
  it('大白话：refund_required 但已退清（售后单退款额覆盖实付）→ 不算死信（否则加了退款入口反而制造永久告警）', async () => {
    control.seed(COLLECTIONS.orders, [{ _id: 'D', status: 'refund_required', amount: 100, paidAt: Date.now() }])
    control.seed(COLLECTIONS.afterSales, [
      { _id: 'D__l1', orderId: 'D', status: 'refunded', refundAmount: 60 },
      { _id: 'D__l2', orderId: 'D', status: 'refunded', refundAmount: 40 }, // 60+40=100 = 实付
    ])
    const run = await runInspection('timer')
    const stuck = run.results.find((r) => r.id === 'stuck-order')!
    expect(stuck.status).toBe('green')
    expect(stuck.samples || []).not.toContain('D')
  })

  it('大白话：refund_required 只退了一部分（多行只退一行）→ 仍算死信（钱没退清就是没人管完）', async () => {
    control.seed(COLLECTIONS.orders, [{ _id: 'P', status: 'refund_required', amount: 100, paidAt: Date.now() }])
    control.seed(COLLECTIONS.afterSales, [{ _id: 'P__l1', orderId: 'P', status: 'refunded', refundAmount: 60 }])
    const run = await runInspection('timer')
    const stuck = run.results.find((r) => r.id === 'stuck-order')!
    expect(stuck.status).toBe('red')
    expect(stuck.samples).toContain('P')
    expect(stuck.severity).toBe('high')
  })

  // 批K 评审 P1：多行订单逐行按 refundShareFen 比例分摊、每行各自 Math.round 且行间不共享余数预算，
  // 「各行分摊之和」常比实付额少几分（amount≠goods 是常态·COUPON 固定券）。这几分**没有任何入口能退**
  // （overrideRefund 只收单行 lineId·行级封顶用尽即 NOTHING_LEFT），若「已退清」判据的分母还是 order.amount，
  // 管理员把每行都退到上限后订单仍「差 1 分」→ 被永久误报高危死信、挤占 samples 前 10 位。
  // 本例走 refundShareFen 真实路径取数（既有用例全是手填整数 refundAmount·测不出本病）：
  // goods=100 / COUPON 20 → amount=80，三行 33.33+33.33+33.34，逐行退到上限＝26.66+26.66+26.67=79.99。
  it('大白话：多行订单每行都退到分摊上限（分摊舍入差 1 分永远退不掉）→ 不算死信（否则该单被永久误报高危）', async () => {
    const items = [
      { lineId: 'l1', productId: 'p1', price: 33.33, qty: 1 },
      { lineId: 'l2', productId: 'p2', price: 33.33, qty: 1 },
      { lineId: 'l3', productId: 'p3', price: 33.34, qty: 1 },
    ]
    control.seed(COLLECTIONS.orders, [
      { _id: 'R', status: 'refund_required', amount: 80, goods: 100, items, paidAt: Date.now() },
    ])
    // 逐行按 overrideRefund 同款 refundShareFen 算出的行上限（真实路径复算·非手填整数）
    control.seed(
      COLLECTIONS.afterSales,
      items.map((it, i) => ({
        _id: 'R__' + it.lineId,
        orderId: 'R',
        status: 'refunded',
        lineId: it.lineId,
        refundAmount: fenToYuan(refundShareFen(toFen(80), toFen(100), asFen(Math.round(toFen(it.price) * it.qty)), asFen(0))),
      }))
    )
    // 前置证据：这三行确实只退得出 79.99，差的 1 分再退任何一行都是 NOTHING_LEFT
    const paid = control.dump(COLLECTIONS.afterSales).reduce((s: number, a: any) => s + toFen(a.refundAmount), 0)
    expect(paid).toBe(7999)
    const run = await runInspection('timer')
    const stuck = run.results.find((r) => r.id === 'stuck-order')!
    expect(stuck.samples || []).not.toContain('R')
    expect(stuck.status).toBe('green')
  })

  it('大白话：多行订单还有整行没退（不是舍入差·是真没退完）→ 仍算死信（放宽判据不能放过真死信）', async () => {
    const items = [
      { lineId: 'l1', productId: 'p1', price: 33.33, qty: 1 },
      { lineId: 'l2', productId: 'p2', price: 33.33, qty: 1 },
      { lineId: 'l3', productId: 'p3', price: 33.34, qty: 1 },
    ]
    control.seed(COLLECTIONS.orders, [
      { _id: 'R2', status: 'refund_required', amount: 80, goods: 100, items, paidAt: Date.now() },
    ])
    control.seed(COLLECTIONS.afterSales, [
      { _id: 'R2__l1', orderId: 'R2', status: 'refunded', lineId: 'l1', refundAmount: 26.66 },
      { _id: 'R2__l2', orderId: 'R2', status: 'refunded', lineId: 'l2', refundAmount: 26.66 }, // l3 整行未退
    ])
    const run = await runInspection('timer')
    const stuck = run.results.find((r) => r.id === 'stuck-order')!
    expect(stuck.status).toBe('red')
    expect(stuck.samples).toContain('R2')
    expect(stuck.severity).toBe('high')
  })

  it('大白话：未到账的售后（applied/approved）不算已退清——只有真 refunded 才算钱到买家手里', async () => {
    control.seed(COLLECTIONS.orders, [{ _id: 'A2', status: 'refund_required', amount: 100, paidAt: Date.now() }])
    control.seed(COLLECTIONS.afterSales, [{ _id: 'A2__l1', orderId: 'A2', status: 'approved', refundAmount: 100 }])
    const run = await runInspection('timer')
    expect(run.results.find((r) => r.id === 'stuck-order')!.samples).toContain('A2')
  })

  it('大白话：售后单查询失败（接口炸）→ 保守按未退清计死信（宁可多报一次，不可漏报真死信·fail-closed）', async () => {
    control.seed(COLLECTIONS.orders, [{ _id: 'F', status: 'refund_required', amount: 100, paidAt: Date.now() }])
    control.seed(COLLECTIONS.afterSales, [{ _id: 'F__l1', orderId: 'F', status: 'refunded', refundAmount: 100 }])
    control.setBeforeGet(({ coll, filter }: any) => {
      // 只炸「按 orderId 批量查已退款售后」这一路（死信退清判据用的查询），不影响其他检查项
      if (coll === COLLECTIONS.afterSales && filter && filter.orderId && filter.status === 'refunded') throw new Error('boom')
    })
    const run = await runInspection('timer')
    const stuck = run.results.find((r) => r.id === 'stuck-order')!
    expect(stuck.status).toBe('red')
    expect(stuck.samples).toContain('F')
  })

  it('大白话：死信退清判据批量读（_.in 分块）——120 单死信零逐条 doc get（不重新引入 N+1）', async () => {
    const orders: any[] = []
    const afterSales: any[] = []
    for (let i = 0; i < 120; i++) {
      orders.push({ _id: 'DD' + i, status: 'refund_required', amount: 100, paidAt: Date.now() })
      // 除 DD77 外全部退清 → 只剩 DD77 是真死信
      afterSales.push({ _id: 'DD' + i + '__l1', orderId: 'DD' + i, status: 'refunded', refundAmount: i === 77 ? 30 : 100 })
    }
    control.seed(COLLECTIONS.orders, orders)
    control.seed(COLLECTIONS.afterSales, afterSales)
    let docGets = 0
    control.setBeforeGet(({ coll, id }: any) => {
      if ((coll === COLLECTIONS.orders || coll === COLLECTIONS.afterSales) && id != null) docGets++
    })
    const run = await runInspection('timer')
    const stuck = run.results.find((r) => r.id === 'stuck-order')!
    expect(stuck.status).toBe('red')
    expect(stuck.samples).toEqual(['DD77'])
    expect(docGets).toBe(0)
  })

  it('大白话：空库/集合缺失也不抛、给出完整三查结果（fail-soft·巡检不反噬）', async () => {
    const run = await runInspection('timer')
    expect(run.results.length).toBe(3)
    expect(run.summary).toBeDefined()
  })

  it('大白话：只读巡检·绝不改业务集合（看护铁律·只新增 inspectRuns/anomalies）', async () => {
    control.seed(COLLECTIONS.orders, [{ _id: 'A', status: 'paid', amount: 100, paidAt: 111 }])
    await runInspection('timer')
    expect(control.dump(COLLECTIONS.orders)).toEqual([{ _id: 'A', status: 'paid', amount: 100, paidAt: 111 }])
  })
})

describe('sendDailyHeartbeat（A5 每日心跳·全绿也报平安·确定性 id 去重）', () => {
  it('大白话：首次跑写 hb:<日> 到 inspectRuns（startedAt:0 不污染体检读路径）·webhook 未配不炸', async () => {
    await sendDailyHeartbeat({ green: 3, red: 0 })
    const hb = control.dump(COLLECTIONS.inspectRuns).find((r: any) => String(r._id).startsWith('hb:'))
    expect(hb).toBeTruthy()
    expect(hb.startedAt).toBe(0) // 心跳档 startedAt:0·getInspectStatus 按 >0 过滤掉它
  })

  it('大白话：同日第二次跑不重复推（确定性 id 撞跳过·病根#2）·只推一次', async () => {
    control.seed(COLLECTIONS.adminConfig, [{ _id: 'settings', alertWebhook: WEBHOOK }])
    const calls: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(url)
      return { json: async () => ({ errcode: 0 }) }
    })
    try {
      await sendDailyHeartbeat({ green: 3, red: 0 })
      await sendDailyHeartbeat({ green: 3, red: 0 })
    } finally {
      vi.unstubAllGlobals()
    }
    expect(calls.length).toBe(1) // 第二次撞 hb id·跳过·只推一次
    expect(control.dump(COLLECTIONS.inspectRuns).filter((r: any) => String(r._id).startsWith('hb:')).length).toBe(1)
  })

  it('大白话：红灯日照发心跳（心跳证巡检机活着·红项另有告警通道）', async () => {
    control.seed(COLLECTIONS.adminConfig, [{ _id: 'settings', alertWebhook: WEBHOOK }])
    const calls: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(url)
      return { json: async () => ({ errcode: 0 }) }
    })
    try {
      await sendDailyHeartbeat({ green: 2, red: 1 })
    } finally {
      vi.unstubAllGlobals()
    }
    expect(calls.length).toBe(1) // 红灯照发心跳（不因有红项而不报平安）
  })

  it('大白话：心跳非异常·绝不落 recordAnomaly（不污染 anomalies 账本）', async () => {
    await sendDailyHeartbeat({ green: 1, red: 2 })
    expect(control.dump(COLLECTIONS.anomalies).length).toBe(0)
  })
})

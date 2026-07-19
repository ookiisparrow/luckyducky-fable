// 黄金 观测-巡检 §B：巡检机「主动核对不变量·探出静默失败」（守卫 rw-inspect-golden）。
// 不依赖 AI 的定时/手动体检：跑一遍检查目录（A 基建存活 + B 业务不变量）→ 写 inspectRuns 体检报告
// → 每条红自动落 recordAnomaly（违反→bug 账本闭环）。只读——绝不改业务集合（「现在只读看护线上」铁律）。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { control } from 'wx-server-sdk'
import { runInspection, sendDailyHeartbeat } from '../src/kit'
import { COLLECTIONS } from '@ldrw/shared'

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

// 变异测试幸存者击杀（kit/inspect.ts·巡检机引擎·守卫 rw-inspect-golden）。
// 背景：StrykerJS 首轮 146 个幸存/无覆盖，本文件补 A 类（真测试缺口）击杀，不与 inspect.test.ts 重复：
//   ① 检查目录元数据契约（id/title/layer 逐字锁——admin 体检面板与 anomaly 指纹都消费它们）；
//   ② 红灯落账契约（anomaly._id 确定性指纹 / kind / code=INSPECT_<ID> / ctx.fp / ctx.samples 逗号拼接）；
//   ③ 有界扫描 capped 语义（三路 >= SCAN_CAP 逐路点亮·触顶显式标 capped、不假装扫全了）；
//   ④ _.in 分块契约（每批 ≤ IN_CHUNK=100 键·恰好 N 批不多发空查询·分块错了 >100 单静默漏扫）；
//   ⑤ fail-soft 读失败兜底（单路查询炸→该路当空集不炸整轮·scanned 如实计 0）；
//   ⑥ 卡单判据逐条件（真付款 transactionId / paidAt>0 / 严格超 72h / 活跃售后豁免仅 applied|approved|refunded）；
//   ⑦ refundableCapFen 死信分母（缺行缺货款退回 amount 口径·qty 参与分摊·脏数据 catch 兜底）；
//   ⑧ 心跳确定性日 id（Asia/Shanghai UTC+8 显式换算·档案形状逐字段锁）。
// 期望值全部取自 inspect.ts 源码常量与注释，未发明行为。钱样本一律整数分可换算（元最多两位小数）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { control } from 'wx-server-sdk'
import { runInspection, sendDailyHeartbeat } from '../src/kit'
import { COLLECTIONS } from '@ldrw/shared'

const HOUR = 3600 * 1000
const STUCK_PAID_MS = 72 * HOUR // 与源码同值（源码此值被变异时，下方红绿断言即翻车）
const SCAN_CAP = 500
const IN_CHUNK = 100

beforeEach(() => control.reset())
afterEach(() => vi.useRealTimers())

function entry(run: Awaited<ReturnType<typeof runInspection>>, id: string) {
  const r = run.results.find((x) => x.id === id)
  expect(r, `检查项 ${id} 必须在报告里`).toBeTruthy()
  return r!
}

describe('检查目录元数据与报告契约（体检面板/指纹的消费面·逐字锁）', () => {
  it('大白话：空库跑一轮→三项全绿、每项 id/title/layer/detail/severity 逐字段对上、报告落库完整', async () => {
    // 分块查询计数：空库时 money/死信两条 _.in 分块循环都不该发任何查询（多发一次空查询=循环边界错）
    const inQueries: string[] = []
    control.setBeforeGet(({ coll, filter }: any) => {
      if (filter && filter._id && filter._id.__op === 'in') inQueries.push('orders:' + filter._id.val.length)
      if (filter && filter.orderId && filter.orderId.__op === 'in') inQueries.push('as:' + filter.orderId.val.length)
    })
    const run = await runInspection('manual')
    expect(entry(run, 'db-reachable')).toEqual({
      id: 'db-reachable',
      title: '数据库可达',
      layer: 'infra',
      status: 'green',
      detail: 'DB 读通',
      severity: 'low',
    })
    expect(entry(run, 'money-conserved')).toEqual({
      id: 'money-conserved',
      title: '钱守恒（退款不超实付）',
      layer: 'invariant',
      status: 'green',
      detail: '退款均未超实付',
      severity: 'low',
      scanned: 0,
      capped: false,
    })
    expect(entry(run, 'stuck-order')).toEqual({
      id: 'stuck-order',
      title: '卡单（付了钱没发货 / 待人工退款死信）',
      layer: 'invariant',
      status: 'green',
      detail: '无卡单/死信',
      severity: 'low',
      scanned: 0,
      capped: false,
    })
    expect(run.summary).toEqual({ green: 3, yellow: 0, red: 0 })
    expect(inQueries).toEqual([]) // 零键=零查询（i<=length 之类的循环边界变异会多发一次空 _.in）
    // 报告确定性 _id + 落库形状（写的是整份 run，不是空壳）
    expect(run._id).toBe(`inspect_manual_${run.startedAt}`)
    const docs = control.dump(COLLECTIONS.inspectRuns)
    expect(docs.length).toBe(1)
    expect(docs[0]._id).toBe(run._id)
    expect(docs[0].trigger).toBe('manual')
    expect(docs[0].results.length).toBe(3)
    expect(docs[0].summary).toEqual({ green: 3, yellow: 0, red: 0 })
  })

  it('大白话：DB 读炸→db-reachable 红、错误文案截 80 字、落 anomaly 契约全对上（指纹/kind/code/fp）', async () => {
    control.setBeforeGet(({ coll }: any) => {
      if (coll === COLLECTIONS.config) throw new Error('X'.repeat(100)) // 超 80 字的错误串·验截断
    })
    const run = await runInspection('manual')
    const db = entry(run, 'db-reachable')
    expect(db.status).toBe('red')
    expect(db.severity).toBe('high')
    expect(db.detail).toBe('DB 读失败：' + ('Error: ' + 'X'.repeat(100)).slice(0, 80))
    expect(run.summary).toEqual({ green: 2, yellow: 0, red: 1 })
    // 红→recordAnomaly 契约：确定性指纹 _id（kind+code+fp）、code=INSPECT_大写下划线、无样本时 samples=''
    const an = control.dump(COLLECTIONS.anomalies)
    expect(an.length).toBe(1)
    expect(an[0]._id).toBe('anom_flow-failure_INSPECT_DB_REACHABLE_db-reachable')
    expect(an[0].kind).toBe('flow-failure')
    expect(an[0].code).toBe('INSPECT_DB_REACHABLE')
    expect(an[0].severity).toBe('high')
    expect(an[0].ctx.fp).toBe('db-reachable')
    expect(an[0].ctx.samples).toBe('')
  })

  it('大白话：inspectRuns 集合缺失→建集合重写、报告不丢（fail-soft 兜底真在干活）', async () => {
    control.markUncreated(COLLECTIONS.inspectRuns)
    const run = await runInspection('manual')
    const docs = control.dump(COLLECTIONS.inspectRuns)
    expect(docs.length).toBe(1)
    expect(docs[0]._id).toBe(run._id)
    expect(docs[0].trigger).toBe('manual')
    expect(docs[0].summary).toEqual(run.summary)
  })
})

describe('钱守恒（money-conserved·超退判定/有界扫描/分块契约）', () => {
  it('大白话：两单超退→红灯文案带条数、samples 按序、anomaly 指纹与 samples 逗号拼接全锁死', async () => {
    control.seed(COLLECTIONS.orders, [
      { _id: 'A', status: 'done', amount: 100 },
      { _id: 'B', status: 'done', amount: 100 },
    ])
    control.seed(COLLECTIONS.afterSales, [
      { _id: 'A__l1', orderId: 'A', status: 'refunded', refundAmount: 130 },
      { _id: 'B__l1', orderId: 'B', status: 'refunded', refundAmount: 200 },
    ])
    const run = await runInspection('timer')
    const money = entry(run, 'money-conserved')
    expect(money.status).toBe('red')
    expect(money.detail).toBe('2 单退款超实付（静默多退钱）')
    expect(money.count).toBe(2)
    expect(money.samples).toEqual(['A', 'B'])
    expect(money.severity).toBe('high')
    const an = control.dump(COLLECTIONS.anomalies)
    expect(an.length).toBe(1)
    expect(an[0]._id).toBe('anom_invariant-violation_INSPECT_MONEY_CONSERVED_money-conserved')
    expect(an[0].kind).toBe('invariant-violation')
    expect(an[0].code).toBe('INSPECT_MONEY_CONSERVED')
    expect(an[0].ctx.fp).toBe('money-conserved')
    expect(an[0].ctx.samples).toBe('A,B') // 逗号拼接（分隔符被削会变 'AB'）
    expect(an[0].ctx.count).toBe('2')
  })

  it('大白话：12 单超退→samples 只留前 10 位（count 仍报全量·不让样本刷屏）', async () => {
    const orders: any[] = []
    const as: any[] = []
    for (let i = 0; i < 12; i++) {
      orders.push({ _id: 'Z' + i, status: 'done', amount: 100 })
      as.push({ _id: 'Z' + i + '__l1', orderId: 'Z' + i, status: 'refunded', refundAmount: 999 })
    }
    control.seed(COLLECTIONS.orders, orders)
    control.seed(COLLECTIONS.afterSales, as)
    const run = await runInspection('timer')
    const money = entry(run, 'money-conserved')
    expect(money.count).toBe(12)
    expect(money.samples!.length).toBe(10)
  })

  it('大白话：只认 refunded（applied 巨额不算）·恰好退清=实付也不算超退→绿', async () => {
    control.seed(COLLECTIONS.orders, [
      { _id: 'A', status: 'done', amount: 100 },
      { _id: 'X', status: 'done', amount: 100 },
    ])
    control.seed(COLLECTIONS.afterSales, [
      { _id: 'A__l1', orderId: 'A', status: 'refunded', refundAmount: 100 }, // 恰好=实付·合法上限
      { _id: 'X__l1', orderId: 'X', status: 'applied', refundAmount: 999 }, // 在途申请·不是已退的钱
    ])
    const run = await runInspection('timer')
    const money = entry(run, 'money-conserved')
    expect(money.status).toBe('green')
    expect(money.scanned).toBe(1) // 只扫到 refunded 那一条
    expect(money.capped).toBe(false)
  })

  it('大白话：恰好扫满 500 条→capped 亮灯（触顶显式标、不假装扫全了）', async () => {
    const as: any[] = []
    for (let i = 0; i < SCAN_CAP; i++) as.push({ _id: 'C' + i, orderId: 'GONE' + i, status: 'refunded', refundAmount: 1 })
    control.seed(COLLECTIONS.afterSales, as)
    const run = await runInspection('timer')
    const money = entry(run, 'money-conserved')
    expect(money.status).toBe('green') // 订单缺失→跳过不误报
    expect(money.scanned).toBe(SCAN_CAP)
    expect(money.capped).toBe(true)
  })

  it('大白话：120 单批量读订单——每批 ≤100 键、恰好 2 批、超退单精准逮到（分块错=静默漏扫）', async () => {
    const orders: any[] = []
    const as: any[] = []
    for (let i = 0; i < 120; i++) {
      orders.push({ _id: 'O' + i, status: 'done', amount: 100 })
      as.push({ _id: 'O' + i + '__l1', orderId: 'O' + i, status: 'refunded', refundAmount: i === 110 ? 130 : 50 })
    }
    control.seed(COLLECTIONS.orders, orders)
    control.seed(COLLECTIONS.afterSales, as)
    const chunkSizes: number[] = []
    control.setBeforeGet(({ coll, filter }: any) => {
      if (coll === COLLECTIONS.orders && filter && filter._id && filter._id.__op === 'in') chunkSizes.push(filter._id.val.length)
    })
    const run = await runInspection('timer')
    const money = entry(run, 'money-conserved')
    expect(money.status).toBe('red')
    expect(money.samples).toEqual(['O110']) // 尾批里的超退单不许漏（不分块+limit 100 就会漏）
    expect(chunkSizes).toEqual([IN_CHUNK, 20]) // 恰好 2 批·每批 ≤100 键
  })

  it('大白话：订单分块查询炸→当读不到订单跳过、不误报也不炸整轮（fail-soft）', async () => {
    control.seed(COLLECTIONS.afterSales, [{ _id: 'A__l1', orderId: 'A', status: 'refunded', refundAmount: 999 }])
    control.setBeforeGet(({ coll, filter }: any) => {
      if (coll === COLLECTIONS.orders && filter && filter._id) throw new Error('boom')
    })
    const run = await runInspection('timer')
    const money = entry(run, 'money-conserved')
    expect(money.status).toBe('green')
    expect(money.detail).toBe('退款均未超实付')
  })

  it('大白话：售后扫描查询炸→当空集、scanned 如实计 0、不炸整轮（fail-soft）', async () => {
    control.seed(COLLECTIONS.afterSales, [{ _id: 'A__l1', orderId: 'A', status: 'refunded', refundAmount: 999 }])
    control.setBeforeGet(({ coll, filter }: any) => {
      // 只炸 money-conserved 的「status:refunded 且无 orderId」这一路
      if (coll === COLLECTIONS.afterSales && filter && filter.status === 'refunded' && !filter.orderId) throw new Error('boom')
    })
    const run = await runInspection('timer')
    const money = entry(run, 'money-conserved')
    expect(money.status).toBe('green')
    expect(money.scanned).toBe(0) // 查询炸=一条没扫到·不许伪造扫描量
  })
})

describe('卡单（stuck-order·72h 判据逐条件/售后豁免面/有界扫描）', () => {
  it('大白话：真付款才 1 小时→不算卡单（72h 阈值真是 72h·不是被变异成的几百毫秒）', async () => {
    control.seed(COLLECTIONS.orders, [{ _id: 'N', status: 'paid', amount: 100, transactionId: 'wxN', paidAt: Date.now() - 1 * HOUR }])
    const run = await runInspection('timer')
    expect(entry(run, 'stuck-order').status).toBe('green')
  })

  it('大白话：paidAt=0（没有付款时间的脏单）→不算卡单（paidAt>0 是硬前置）', async () => {
    control.seed(COLLECTIONS.orders, [{ _id: 'Z', status: 'paid', amount: 100, transactionId: 'wxZ', paidAt: 0 }])
    const run = await runInspection('timer')
    expect(entry(run, 'stuck-order').status).toBe('green')
  })

  it('大白话：恰好整 72h→还不算卡单（严格「超」72h 才报·边界不误伤）', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-24T12:00:00Z'))
    control.seed(COLLECTIONS.orders, [
      { _id: 'E', status: 'paid', amount: 100, transactionId: 'wxE', paidAt: Date.now() - STUCK_PAID_MS },
    ])
    const run = await runInspection('timer')
    expect(entry(run, 'stuck-order').status).toBe('green')
  })

  it('大白话：done 状态的老单不算卡单（只扫 status=paid·不是全库乱扫）', async () => {
    control.seed(COLLECTIONS.orders, [{ _id: 'D', status: 'done', amount: 100, transactionId: 'wxD', paidAt: Date.now() - 80 * HOUR }])
    const run = await runInspection('timer')
    expect(entry(run, 'stuck-order').status).toBe('green')
  })

  it('大白话：rejected 售后不豁免卡单（驳回=发货义务还在·豁免面只有 applied/approved/refunded）', async () => {
    control.seed(COLLECTIONS.orders, [{ _id: 'S', status: 'paid', amount: 100, transactionId: 'wxS', paidAt: Date.now() - 80 * HOUR }])
    control.seed(COLLECTIONS.afterSales, [{ _id: 'S__l1', orderId: 'S', status: 'rejected', refundAmount: 100 }])
    const run = await runInspection('timer')
    const stuck = entry(run, 'stuck-order')
    expect(stuck.status).toBe('red')
    expect(stuck.samples).toContain('S')
  })

  it('大白话：applied 售后豁免卡单（申请中=正在退款·非发货义务）', async () => {
    control.seed(COLLECTIONS.orders, [{ _id: 'S', status: 'paid', amount: 100, transactionId: 'wxS', paidAt: Date.now() - 80 * HOUR }])
    control.seed(COLLECTIONS.afterSales, [{ _id: 'S__l1', orderId: 'S', status: 'applied', refundAmount: 100 }])
    const run = await runInspection('timer')
    expect(entry(run, 'stuck-order').status).toBe('green')
  })

  it('大白话：refunded 售后豁免卡单（钱都退了·不是该发没发）', async () => {
    control.seed(COLLECTIONS.orders, [{ _id: 'S', status: 'paid', amount: 100, transactionId: 'wxS', paidAt: Date.now() - 80 * HOUR }])
    control.seed(COLLECTIONS.afterSales, [{ _id: 'S__l1', orderId: 'S', status: 'refunded', refundAmount: 100 }])
    const run = await runInspection('timer')
    expect(entry(run, 'stuck-order').status).toBe('green')
  })

  it('大白话：单纯超时未发（无死信）→红但低危、文案条数分开报', async () => {
    control.seed(COLLECTIONS.orders, [{ _id: 'S1', status: 'paid', amount: 100, transactionId: 'wxS1', paidAt: Date.now() - 80 * HOUR }])
    const run = await runInspection('timer')
    const stuck = entry(run, 'stuck-order')
    expect(stuck.status).toBe('red')
    expect(stuck.severity).toBe('low') // 纯超时未发＝低危提醒（死信才高危）
    expect(stuck.detail).toBe('1 单真付款超 72h 未发货·0 单待人工退款死信')
    expect(stuck.count).toBe(1)
    expect(stuck.samples).toEqual(['S1'])
  })

  it('大白话：12 单卡单→samples 只留前 10 位', async () => {
    const orders: any[] = []
    for (let i = 0; i < 12; i++) orders.push({ _id: 'K' + i, status: 'paid', amount: 100, transactionId: 'wxK' + i, paidAt: Date.now() - 80 * HOUR })
    control.seed(COLLECTIONS.orders, orders)
    const run = await runInspection('timer')
    const stuck = entry(run, 'stuck-order')
    expect(stuck.count).toBe(12)
    expect(stuck.samples!.length).toBe(10)
  })

  it('大白话：refund_required 且实付读不到（amount=0）→保守计死信·高危·anomaly 契约锁死', async () => {
    control.seed(COLLECTIONS.orders, [{ _id: 'D0', status: 'refund_required', amount: 0, paidAt: Date.now() }])
    const run = await runInspection('timer')
    const stuck = entry(run, 'stuck-order')
    expect(stuck.status).toBe('red')
    expect(stuck.severity).toBe('high')
    expect(stuck.detail).toBe('0 单真付款超 72h 未发货·1 单待人工退款死信')
    expect(stuck.samples).toEqual(['D0'])
    const an = control.dump(COLLECTIONS.anomalies)
    expect(an.length).toBe(1)
    expect(an[0]._id).toBe('anom_invariant-violation_INSPECT_STUCK_ORDER_stuck-order')
    expect(an[0].kind).toBe('invariant-violation')
    expect(an[0].code).toBe('INSPECT_STUCK_ORDER')
  })

  it('大白话：scanned=paid+dead+活跃售后三路相加·未触顶 capped=false', async () => {
    control.seed(COLLECTIONS.orders, [
      { _id: 'P1', status: 'paid', amount: 100, transactionId: 'wxP1', paidAt: Date.now() - 1 * HOUR }, // 近期·不卡
      { _id: 'D1', status: 'refund_required', amount: 100, paidAt: Date.now() }, // 已退清·非死信
    ])
    control.seed(COLLECTIONS.afterSales, [{ _id: 'D1__l1', orderId: 'D1', status: 'refunded', refundAmount: 100 }])
    const run = await runInspection('timer')
    const stuck = entry(run, 'stuck-order')
    expect(stuck.status).toBe('green')
    expect(stuck.scanned).toBe(3) // 1 paid + 1 dead + 1 活跃售后
    expect(stuck.capped).toBe(false)
  })

  it('大白话：paid 一路扫满 500→capped 亮灯（其余两路不满也得亮）', async () => {
    const orders: any[] = []
    for (let i = 0; i < SCAN_CAP; i++) orders.push({ _id: 'P' + i, status: 'paid', amount: 100, paidAt: Date.now() })
    control.seed(COLLECTIONS.orders, orders)
    const run = await runInspection('timer')
    const stuck = entry(run, 'stuck-order')
    expect(stuck.status).toBe('green')
    expect(stuck.capped).toBe(true)
  })

  it('大白话：refund_required 一路扫满 500→capped 亮灯', async () => {
    const orders: any[] = []
    for (let i = 0; i < SCAN_CAP; i++) orders.push({ _id: 'D' + i, status: 'refund_required', amount: 100, paidAt: Date.now() })
    control.seed(COLLECTIONS.orders, orders)
    const run = await runInspection('timer')
    const stuck = entry(run, 'stuck-order')
    expect(stuck.status).toBe('red') // 500 单死信全红（本例只验 capped·红是既有语义）
    expect(stuck.capped).toBe(true)
  })

  it('大白话：活跃售后一路扫满 500→capped 亮灯', async () => {
    const as: any[] = []
    for (let i = 0; i < SCAN_CAP; i++) as.push({ _id: 'AS' + i, orderId: 'G' + i, status: 'applied', refundAmount: 1 })
    control.seed(COLLECTIONS.afterSales, as)
    const run = await runInspection('timer')
    const stuck = entry(run, 'stuck-order')
    expect(stuck.status).toBe('green')
    expect(stuck.capped).toBe(true)
  })

  it('大白话：120 单死信退清判据批量读——每批 ≤100 键、恰好 2 批、尾批真死信不许漏', async () => {
    const orders: any[] = []
    const as: any[] = []
    for (let i = 0; i < 120; i++) {
      orders.push({ _id: 'DD' + i, status: 'refund_required', amount: 100, paidAt: Date.now() })
      as.push({ _id: 'DD' + i + '__l1', orderId: 'DD' + i, status: 'refunded', refundAmount: i === 110 ? 30 : 100 })
    }
    control.seed(COLLECTIONS.orders, orders)
    control.seed(COLLECTIONS.afterSales, as)
    const chunkSizes: number[] = []
    control.setBeforeGet(({ coll, filter }: any) => {
      if (coll === COLLECTIONS.afterSales && filter && filter.orderId && filter.orderId.__op === 'in') chunkSizes.push(filter.orderId.val.length)
    })
    const run = await runInspection('timer')
    const stuck = entry(run, 'stuck-order')
    expect(stuck.status).toBe('red')
    expect(stuck.samples).toEqual(['DD110'])
    expect(chunkSizes).toEqual([IN_CHUNK, 20])
  })

  it('大白话：活跃售后查询炸→当空集不豁免误算、也不炸整轮·scanned 如实少一路', async () => {
    control.seed(COLLECTIONS.orders, [{ _id: 'P1', status: 'paid', amount: 100, transactionId: 'wxP1', paidAt: Date.now() - 1 * HOUR }])
    control.setBeforeGet(({ coll, filter }: any) => {
      if (coll === COLLECTIONS.afterSales && filter && filter.status && typeof filter.status === 'object' && filter.status.__op === 'in')
        throw new Error('boom')
    })
    const run = await runInspection('timer')
    const stuck = entry(run, 'stuck-order')
    expect(stuck.status).toBe('green')
    expect(stuck.scanned).toBe(1) // 1 paid + 0 dead + 0 售后（炸了就是 0·不伪造）
  })

  it('大白话：paid 查询炸→该路当空集、不炸整轮·scanned=0', async () => {
    control.seed(COLLECTIONS.orders, [{ _id: 'S', status: 'paid', amount: 100, transactionId: 'wxS', paidAt: Date.now() - 80 * HOUR }])
    control.setBeforeGet(({ coll, filter }: any) => {
      if (coll === COLLECTIONS.orders && filter && filter.status === 'paid') throw new Error('boom')
    })
    const run = await runInspection('timer')
    const stuck = entry(run, 'stuck-order')
    expect(stuck.status).toBe('green')
    expect(stuck.scanned).toBe(0)
  })

  it('大白话：refund_required 查询炸→该路当空集、不炸整轮·scanned=0', async () => {
    control.seed(COLLECTIONS.orders, [{ _id: 'D', status: 'refund_required', amount: 100, paidAt: Date.now() }])
    control.setBeforeGet(({ coll, filter }: any) => {
      if (coll === COLLECTIONS.orders && filter && filter.status === 'refund_required') throw new Error('boom')
    })
    const run = await runInspection('timer')
    const stuck = entry(run, 'stuck-order')
    expect(stuck.status).toBe('green')
    expect(stuck.scanned).toBe(0)
  })
})

describe('refundableCapFen（死信「已退清」分母·经死信判据可观测）', () => {
  it('大白话：goods 在但 items 缺（快照不全）→分母保守退回 amount 口径·退清即不算死信', async () => {
    control.seed(COLLECTIONS.orders, [{ _id: 'R', status: 'refund_required', amount: 100, goods: 100, paidAt: Date.now() }])
    control.seed(COLLECTIONS.afterSales, [{ _id: 'R__l1', orderId: 'R', status: 'refunded', refundAmount: 100 }])
    const run = await runInspection('timer')
    expect(entry(run, 'stuck-order').status).toBe('green')
  })

  it('大白话：items 在但 goods 缺（货款快照缺）→同样保守用 amount·退清即不算死信', async () => {
    control.seed(COLLECTIONS.orders, [
      { _id: 'R', status: 'refund_required', amount: 100, items: [{ lineId: 'l1', price: 100, qty: 1 }], paidAt: Date.now() },
    ])
    control.seed(COLLECTIONS.afterSales, [{ _id: 'R__l1', orderId: 'R', status: 'refunded', refundAmount: 100 }])
    const run = await runInspection('timer')
    expect(entry(run, 'stuck-order').status).toBe('green')
  })

  it('大白话：qty=2 的行只退了一半（100/200 元·即 10000/20000 分）→分摊上限按 价×数量 算·仍是死信', async () => {
    control.seed(COLLECTIONS.orders, [
      { _id: 'Q', status: 'refund_required', amount: 200, goods: 200, items: [{ lineId: 'l1', price: 100, qty: 2 }], paidAt: Date.now() },
    ])
    control.seed(COLLECTIONS.afterSales, [{ _id: 'Q__l1', orderId: 'Q', status: 'refunded', refundAmount: 100 }])
    const run = await runInspection('timer')
    const stuck = entry(run, 'stuck-order')
    expect(stuck.status).toBe('red') // 上限 20000 分只退了 10000 分——qty 不参与分摊的变异会把上限算小放走它
    expect(stuck.samples).toEqual(['Q'])
  })

  it('大白话：items 里混进 null 脏行（读属性直接炸）→catch 兜回 amount 口径·退清不误报', async () => {
    control.seed(COLLECTIONS.orders, [{ _id: 'N', status: 'refund_required', amount: 100, goods: 100, items: [null], paidAt: Date.now() }])
    control.seed(COLLECTIONS.afterSales, [{ _id: 'N__l1', orderId: 'N', status: 'refunded', refundAmount: 100 }])
    const run = await runInspection('timer')
    expect(entry(run, 'stuck-order').status).toBe('green')
  })
})

describe('sendDailyHeartbeat（确定性日 id·Asia/Shanghai 显式换算·档案形状）', () => {
  it('大白话：UTC 晚上 8 点=上海次日凌晨 4 点→日 id 取上海日期、档案逐字段锁死', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-24T20:00:00Z')) // UTC+8 已是 07-25——换算错 8 小时就会写成 07-24
    await sendDailyHeartbeat({ green: 3, red: 1 })
    const docs = control.dump(COLLECTIONS.inspectRuns)
    expect(docs.length).toBe(1)
    expect(docs[0]).toEqual({
      _id: 'hb:20260725',
      startedAt: 0, // 心跳档 startedAt:0·不污染体检读路径
      finishedAt: 0,
      trigger: 'timer',
      summary: { green: 3, red: 1 }, // 落当日真实计数·直查审计不被占位 0/0 误导
      results: [],
    })
  })
})

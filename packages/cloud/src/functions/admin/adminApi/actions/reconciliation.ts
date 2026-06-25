import { toFen, asFen, fenToYuan } from '@luckyducky/shared'
import { reply, getTxAlerts, PAID_STATUSES, type Ctx } from '../lib'

// —— S16 财务对账（内部账·Batch 1）——
// 口径同看板 GMV（PAID_STATUSES·已付营收）。三块：① 收支汇总 ② 每日流水 ③ 内部异常（txAlerts 单源）。
//   · 累计总额走 aggregate $.sum 精确（不封顶·债#18续）——money 锚，恒可信。
//   · 每日明细走有界拉取（CAP）+ JS 按 CST 日分桶（云端 aggregate 不便按日分组），超 CAP 标 approx
//     （同 dashboard SAMPLE 诚实范式·债#18；低量业务远不触）。
//   · 内部异常＝feeMismatch/refundMismatch/stuckRefunds（getTxAlerts 与看板同源·防漂移）。
// 抓「我方内部不一致」；抓不到「微信收了款我方无单」——那需逐笔比对微信账单（外部对账·Batch 2/3·需商户凭证）。

const CAP = 2000 // 每日明细有界拉取上限（超则 approx；同 dashboard SAMPLE 范式）
const DAY = 86400_000
const CST = 8 * 3600_000 // 东八区·按中国日历日分桶

// ms 时间戳 → CST 日历日 'YYYY-MM-DD'
const dayKey = (ts: number) => new Date(Number(ts) + CST).toISOString().slice(0, 10)
// 'YYYY-MM-DD' → CST 当日 00:00:00 的 ms
const dayStartMs = (d: string) => Date.parse(d + 'T00:00:00+08:00')
const isDate = (s: any) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)

// 累加用整数「分」（toFen·防浮点漂移·根因#4 钱链）；出参再 fenToYuan 回元
interface Bucket {
  day: string
  incomeFen: number
  refundFen: number
  orders: number
  refunds: number
}

export async function getReconciliation({ db, data }: Ctx) {
  const _ = db.command
  const $ = db.command.aggregate
  // 范围（CST）：默认近 30 天；传 from/to（'YYYY-MM-DD'）则用之
  const to = isDate(data?.to) ? data.to : dayKey(Date.now())
  const from = isDate(data?.from) ? data.from : dayKey(Date.now() - 29 * DAY)
  const fromMs = dayStartMs(from)
  const toMs = dayStartMs(to) + DAY - 1 // 含 to 当日

  const sumAgg = (coll: string, status: any, field: string): Promise<number> =>
    db
      .collection(coll)
      .aggregate()
      .match({ status })
      .group({ _id: null, s: $.sum('$' + field) })
      .end()
      .then((r: any) => (r.list && r.list[0] ? Number(r.list[0].s) || 0 : 0))
      .catch(() => 0)
  const rows = (q: any) =>
    q
      .get()
      .then((r: any) => r.data)
      .catch(() => [])
  const cnt = (q: any) =>
    q
      .count()
      .then((r: any) => r.total || 0)
      .catch(() => 0)

  const [incomeCum, refundCum, paidRows, refundRows, paidN, refundN, exceptions] = await Promise.all([
    // 累计（aggregate·全量精确·不封顶·money 锚）
    sumAgg('orders', _.in(PAID_STATUSES), 'amount'),
    sumAgg('afterSales', 'refunded', 'refundAmount'),
    // 每日明细有界拉取（最近 CAP 笔·按时间倒序）
    rows(db.collection('orders').where({ status: _.in(PAID_STATUSES) }).orderBy('paidAt', 'desc').limit(CAP)),
    rows(db.collection('afterSales').where({ status: 'refunded' }).orderBy('refundedAt', 'desc').limit(CAP)),
    cnt(db.collection('orders').where({ status: _.in(PAID_STATUSES) })),
    cnt(db.collection('afterSales').where({ status: 'refunded' })),
    getTxAlerts(db),
  ])

  // JS 按 CST 日分桶（窗内）：income 自 paidRows.paidAt，refund 自 refundRows.refundedAt（累加整数分）
  const buckets = new Map<string, Bucket>()
  const bucket = (day: string): Bucket => {
    let b = buckets.get(day)
    if (!b) buckets.set(day, (b = { day, incomeFen: 0, refundFen: 0, orders: 0, refunds: 0 }))
    return b
  }
  const inRange = (ts: any) => typeof ts === 'number' && ts >= fromMs && ts <= toMs
  for (const o of paidRows) {
    if (!inRange(o.paidAt)) continue
    const b = bucket(dayKey(o.paidAt))
    b.incomeFen += toFen(Number(o.amount) || 0)
    b.orders += 1
  }
  for (const a of refundRows) {
    if (!inRange(a.refundedAt)) continue
    const b = bucket(dayKey(a.refundedAt))
    b.refundFen += toFen(Number(a.refundAmount) || 0)
    b.refunds += 1
  }
  const sorted = [...buckets.values()].sort((x, y) => (x.day < y.day ? -1 : 1))
  const daily = sorted.map((b) => ({
    day: b.day,
    income: fenToYuan(asFen(b.incomeFen)),
    refund: fenToYuan(asFen(b.refundFen)),
    net: fenToYuan(asFen(b.incomeFen - b.refundFen)),
    orders: b.orders,
    refunds: b.refunds,
  }))

  // 区间汇总：分累加再回元（与每日同源·精确）
  let incFen = 0
  let refFen = 0
  let ordersN = 0
  let refundsN = 0
  for (const b of sorted) {
    incFen += b.incomeFen
    refFen += b.refundFen
    ordersN += b.orders
    refundsN += b.refunds
  }

  return reply(200, {
    ok: true,
    range: { from, to },
    // 累计（aggregate 全量·元）；net 经分相减回元避浮点
    cumulative: { income: incomeCum, refund: refundCum, net: fenToYuan(asFen(toFen(incomeCum) - toFen(refundCum))) },
    summary: {
      income: fenToYuan(asFen(incFen)),
      refund: fenToYuan(asFen(refFen)),
      net: fenToYuan(asFen(incFen - refFen)),
      orders: ordersN,
      refunds: refundsN,
    },
    daily,
    // 窗内明细可能被 CAP 截断（低量远不触·诚实标注·债#18）；累计/异常不受 CAP 影响
    approx: paidN > CAP || refundN > CAP,
    exceptions,
  })
}

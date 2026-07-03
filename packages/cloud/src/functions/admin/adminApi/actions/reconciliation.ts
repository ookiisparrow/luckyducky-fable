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

// —— S16 外部对账 Batch 3：我方付款单 ⋈ wxBills（微信权威账单）逐笔比对 ——
// 四类：✅平 / 🔴微信有我方无（收了款无单·最危险）/ 🔴我方有微信无（仅该日账单已拉时才判·防误报）/ 🔴金额不符。
// 抓内部账抓不到的「微信有款我方无单」。须先 downloadBill 拉账单进 wxBills（未拉的日期 = 无数据·非差异）。
export async function getBillMatch({ db, data }: Ctx) {
  const _ = db.command
  const to = isDate(data?.to) ? data.to : dayKey(Date.now())
  const from = isDate(data?.from) ? data.from : dayKey(Date.now() - 29 * DAY)
  const fromMs = dayStartMs(from)
  const toMs = dayStartMs(to) + DAY - 1
  const rows = (q: any) =>
    q
      .get()
      .then((r: any) => r.data)
      .catch(() => [])

  // 取最近 CAP 条再按窗过滤；触顶＝更早的单没进比对面，老窗口里的真单会被误判 wxOnly——必须 approx 如实标注
  //（深审 P2·同 getReconciliation 口径·守卫 billmatch-approx-flag），前端见 approx 提示「窗口可能不全」而非当真差异。
  const rawOur = await rows(db.collection('orders').where({ status: _.in(PAID_STATUSES) }).orderBy('paidAt', 'desc').limit(CAP))
  const rawWx = await rows(db.collection('wxBills').orderBy('date', 'desc').limit(CAP))
  const approx = rawOur.length >= CAP || rawWx.length >= CAP
  const ourOrders = rawOur.filter((o: any) => typeof o.paidAt === 'number' && o.paidAt >= fromMs && o.paidAt <= toMs)
  const wxRows = rawWx.filter((w: any) => w.date >= from && w.date <= to && String(w.tradeState) === 'SUCCESS')

  const billDays = [...new Set(wxRows.map((w: any) => w.date))].sort()
  const ourByTxn = new Map(ourOrders.map((o: any) => [String(o.transactionId || ''), o]))
  const ourById = new Map(ourOrders.map((o: any) => [String(o.id || ''), o]))
  const wxByTxn = new Map(wxRows.map((w: any) => [String(w.transactionId || ''), w]))
  const wxByOut = new Map(wxRows.map((w: any) => [String(w.outTradeNo || ''), w]))

  const matched: string[] = []
  const wxOnly: any[] = []
  const oursOnly: any[] = []
  const amountMismatch: any[] = []

  for (const w of wxRows) {
    const our: any = ourByTxn.get(String(w.transactionId || '')) || ourById.get(String(w.outTradeNo || ''))
    if (!our) {
      wxOnly.push({ transactionId: w.transactionId, outTradeNo: w.outTradeNo, amount: w.orderAmount, date: w.date })
      continue
    }
    if (toFen(Number(our.amount) || 0) !== toFen(Number(w.orderAmount) || 0))
      amountMismatch.push({ id: our.id, transactionId: w.transactionId, ourAmount: our.amount, wxAmount: w.orderAmount })
    else matched.push(our.id)
  }
  for (const o of ourOrders) {
    if (!billDays.includes(dayKey(o.paidAt))) continue // 该日未拉账单·无数据·不判（防误报）
    if (!wxByTxn.get(String(o.transactionId || '')) && !wxByOut.get(String(o.id || '')))
      oursOnly.push({ id: o.id, transactionId: o.transactionId || '', amount: o.amount, paidAt: o.paidAt })
  }

  return reply(200, {
    ok: true,
    range: { from, to },
    summary: { matched: matched.length, wxOnly: wxOnly.length, oursOnly: oursOnly.length, amountMismatch: amountMismatch.length },
    discrepancies: { wxOnly, oursOnly, amountMismatch },
    billDays,
    approx, // 比对面触 CAP 截断（深审 P2）：true 时差异可能是截断假象、勿当真差异（前端提示）
  })
}

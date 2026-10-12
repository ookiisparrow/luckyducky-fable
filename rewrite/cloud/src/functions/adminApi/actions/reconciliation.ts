import {
  COLLECTIONS,
  asFen,
  fenToYuan,
  MONEY_RECEIVED_STATUSES,
  dayKeyCST as dayKey,
  dayStartMsCST as dayStartMs,
  type CollectionName,
} from '@ldrw/shared'
import { reply, getTxAlerts, type Ctx } from '../lib'
// 比对分类器在 kit/reconcile（timers/billReconcile 复用同一套原语）；北京日助手在 @ldrw/shared cst.ts。
// DAY_MS 取别名 DAY，文件内沿用短名
import {
  notifyAlert,
  matchBillRows,
  readWindow,
  toFenAmount,
  toYuanAmount,
  DAY_MS as DAY,
  isCollectionMissing,
} from '../../../kit'

// —— 财务对账（内部账）——
// 收入口径＝已收到钱的单（MONEY_RECEIVED_STATUSES，比看板 GMV 多 refund_required/payment_exception：
// 它们的退款照常计入，收入漏了就对不平）。三块：① 收支汇总 ② 每日流水 ③ 内部异常（txAlerts 单源）。
//   · payment_exception 的到账额和标价不符（正是它异常的原因），收入按实际到账 paidFee（分）计，与它退款的
//     分母同口径；缺 paidFee（待补录实付）的计 0——累计聚合对缺字段也是 0，两处一致。
//   · 累计总额走 aggregate $.sum 精确（不封顶）——money 锚，恒可信。
//   · 每日明细按窗读全（kit readWindow：窗口进 where、游标翻页）+ JS 按 CST 日分桶（云端 aggregate 不便按日分组）；
//     窗内超过读取上限才标 approx。
//   · 内部异常＝feeMismatch/refundMismatch/stuckRefunds（getTxAlerts 与看板同源·防漂移）。
// 抓「我方内部不一致」；抓不到「微信收了款我方无单」——那需逐笔比对微信账单（外部对账·需商户凭证）。

const isDate = (s: any) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
const AMOUNT_INCOME_STATUSES = MONEY_RECEIVED_STATUSES.filter((s) => s !== 'payment_exception')
const receivedFen = (o: any): number =>
  o.status === 'payment_exception' ? (Number.isInteger(o.paidFee) ? o.paidFee : 0) : toFenAmount(o.amount)

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

  // 任一路读失败（累计聚合 / 每日明细）都置 degraded + 告警，回传 partial 让前端标注数据不可信（病根#14）：
  // 「查询失败」归零会被读成「这段时间没收入、没退款、已对平」。
  let degraded = false
  const sumAgg = (coll: CollectionName, status: any, field: string): Promise<number> =>
    db
      .collection(coll)
      .aggregate()
      .match({ status })
      .group({ _id: null, s: $.sum('$' + field) })
      .end()
      .then((r: any) => (r.list && r.list[0] ? toYuanAmount(r.list[0].s) : 0))
      .catch(() => {
        degraded = true
        return 0
      })
  const degrade = () => {
    degraded = true
    return { rows: [] as any[], capped: false }
  }

  const [amountCum, exceptionFenCum, refundCum, paid, refunded, exceptions] = await Promise.all([
    // 累计（aggregate·全量精确·不封顶·money 锚）：按标价的单（元）与支付异常单的到账额（分）分开汇总
    sumAgg(COLLECTIONS.orders, _.in(AMOUNT_INCOME_STATUSES), 'amount'),
    sumAgg(COLLECTIONS.orders, 'payment_exception', 'paidFee'),
    sumAgg(COLLECTIONS.afterSales, 'refunded', 'refundAmount'),
    readWindow(db, COLLECTIONS.orders, { status: _.in([...MONEY_RECEIVED_STATUSES]) }, 'paidAt', fromMs, toMs + 1).catch(degrade),
    readWindow(db, COLLECTIONS.afterSales, { status: 'refunded' }, 'refundedAt', fromMs, toMs + 1).catch(degrade),
    getTxAlerts(db),
  ])
  const incomeCum = fenToYuan(asFen(toFenAmount(amountCum) + Math.round(exceptionFenCum)))

  // JS 按 CST 日分桶：income 自 paidAt，refund 自 refundedAt（累加整数分）
  const buckets = new Map<string, Bucket>()
  const bucket = (day: string): Bucket => {
    let b = buckets.get(day)
    if (!b) buckets.set(day, (b = { day, incomeFen: 0, refundFen: 0, orders: 0, refunds: 0 }))
    return b
  }
  for (const o of paid.rows) {
    const b = bucket(dayKey(o.paidAt))
    b.incomeFen += receivedFen(o)
    b.orders += 1
  }
  for (const a of refunded.rows) {
    const b = bucket(dayKey(a.refundedAt))
    b.refundFen += toFenAmount(a.refundAmount)
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
  const sum = (k: 'incomeFen' | 'refundFen' | 'orders' | 'refunds') => sorted.reduce((s, b) => s + b[k], 0)
  const incFen = sum('incomeFen')
  const refFen = sum('refundFen')

  if (degraded) await notifyAlert('money', 'reconciliation', 'RECON_READ_FAIL', { from, to })
  const partial = degraded || !!(exceptions as any).partial
  return reply(200, {
    ok: true,
    range: { from, to },
    partial, // 任一路读失败（累计聚合/每日明细/计数/异常查询）：数据不可信标记（前端提示重试·别当真 0/all-clear）
    // 累计（aggregate 全量·元）；net 经分相减回元避浮点
    cumulative: {
      income: incomeCum,
      refund: refundCum,
      net: fenToYuan(asFen(toFenAmount(incomeCum) - toFenAmount(refundCum))),
    },
    summary: {
      income: fenToYuan(asFen(incFen)),
      refund: fenToYuan(asFen(refFen)),
      net: fenToYuan(asFen(incFen - refFen)),
      orders: sum('orders'),
      refunds: sum('refunds'),
    },
    daily,
    // 窗内明细超过读取上限（丢了窗内最早的一段）；累计/异常不受影响
    approx: paid.capped || refunded.capped,
    exceptions,
  })
}

// —— 外部对账：我方付款单 ⋈ wxBills（微信权威账单）逐笔比对 ——
// 四类：✅平 / 🔴微信有我方无（收了款无单·最危险）/ 🔴我方有微信无（仅该日账单已拉时才判·防误报）/ 🔴金额不符。
// 抓内部账抓不到的「微信有款我方无单」。须先 downloadBill 拉账单进 wxBills（未拉的日期 = 无数据·非差异）。
export async function getBillMatch({ db, data }: Ctx) {
  const _ = db.command
  const to = isDate(data?.to) ? data.to : dayKey(Date.now())
  const from = isDate(data?.from) ? data.from : dayKey(Date.now() - 29 * DAY)
  const fromMs = dayStartMs(from)
  const toMs = dayStartMs(to) + DAY - 1
  // 读失败不接住（交网关回 500，前端报加载失败）：订单读挂了会把每笔微信流水判成「微信有我方无」，账单读挂了
  // 会假装全平。集合未建＝wxBills 从没拉过账单，是合法空态。
  const missingOk = (e: unknown) => {
    if (isCollectionMissing(e)) return { rows: [] as any[], capped: false }
    throw e
  }

  // 窗内读全；真触读取上限＝窗内最早的单没进比对面，那几天的真单会被误判 wxOnly——必须 approx 如实标注
  //（同 getReconciliation 口径·守卫 billmatch-approx-flag），前端见 approx 提示「窗口可能不全」而非当真差异。
  const [our, wx] = await Promise.all([
    readWindow(db, COLLECTIONS.orders, { status: _.in([...MONEY_RECEIVED_STATUSES]) }, 'paidAt', fromMs, toMs + 1).catch(missingOk),
    readWindow(db, COLLECTIONS.wxBills, {}, 'date', from, dayKey(toMs + 1)).catch(missingOk),
  ])
  const approx = our.capped || wx.capped
  const ourOrders = our.rows
  const wxRows = wx.rows.filter((w: any) => String(w.tradeState) === 'SUCCESS')

  const billDays = [...new Set(wxRows.map((w: any) => w.date))].sort()
  const wxByTxn = new Map(wxRows.map((w: any) => [String(w.transactionId || ''), w]))
  const wxByOut = new Map(wxRows.map((w: any) => [String(w.outTradeNo || ''), w]))

  // 三分支分类（平/微信有我方无/金额不符）提纯 kit matchBillRows（timer 复用同一分类器·分整数比对·根因#4）；
  // oursOnly（我方有微信无）需「账单覆盖日」上下文防误报，留本地判。
  const { matched, wxOnly, amountMismatch } = matchBillRows(ourOrders, wxRows)
  const oursOnly: any[] = []

  for (const o of ourOrders) {
    if (!billDays.includes(dayKey(o.paidAt))) continue // 该日未拉账单·无数据·不判（防误报）
    if (!wxByTxn.get(String(o.transactionId || '')) && !wxByOut.get(String(o.id || '')))
      oursOnly.push({
        id: o.id,
        transactionId: o.transactionId || '',
        amount: toYuanAmount(o.amount),
        paidAt: o.paidAt,
      })
  }

  return reply(200, {
    ok: true,
    range: { from, to },
    summary: {
      matched: matched.length,
      wxOnly: wxOnly.length,
      oursOnly: oursOnly.length,
      amountMismatch: amountMismatch.length,
    },
    discrepancies: { wxOnly, oursOnly, amountMismatch },
    billDays,
    approx, // 比对面触读取上限：true 时差异可能是截断假象、勿当真差异（前端提示）
  })
}

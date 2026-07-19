import { ERR, COLLECTIONS, PAID_ORDER_STATUSES, anomalyFingerprint } from '@ldrw/shared'
import {
  isServerCall,
  ok,
  err,
  getDb,
  recordAnomaly,
  notifyAlert,
  pullBillDay,
  matchBillRows,
  dayKeyCST,
  dayStartMsCST,
  DAY_MS,
  type WxFetch,
} from '../../kit'

// —— 每日自动对账 timer（钱链·批B2·守卫 rw-bill-reconcile-golden）——
// 病根#14：closeExpiredOrders 从不查微信侧，「微信有款我方无单」（wxOnly·最危险类）此前唯一链路是
// admin 手动点开 getBillMatch——没人点开就没人知道。本 timer 每日拉前一日微信账单→落 wxBills→比对，
// 差异高危入账（anomalies 指纹去重·同日重跑天然幂等#1）+ 首见 [LD_ALERT] + 新指纹才推 run 级汇总告警。
// 复用清单：kit/reconcile（pullBillDay 拉+落 / matchBillRows 纯分类器·与 admin 手动路径同一套原语）
// + kit/wxpay fetchTradeBill（出站单点#12）+ kit/anomaly 指纹去重。
// 凭证部署注意：env 兜底是**函数进程级**——本函数不继承 adminApi 的环境变量；凭证须入库
// （secureConfig/wxpay·admin 配置清单页可填）或本函数同配 env，否则每日静默 skipped（有 low 面包屑可查）。
// oursOnly（我方有微信无）刻意不在 timer 告警：账单生成时点边界易误报（我方 paidAt 与微信账单归日
// 可差一日），留 admin getBillMatch 手动核（有「账单覆盖日」上下文防误报）——刻意取舍，勿在此补。
// 服务端专用（同 timers/inspect）：客户端调用拒——防刷造对账/告警。
export const main = async () => {
  if (!isServerCall()) return err(ERR.SERVER_ONLY)
  return runBillReconcile(getDb())
}

/** 跑一轮对账（导出供测试直驱·fetchImpl/now/cap 可注入）。**fail-soft 全程不抛**（timer 无人盯返回值·失败走告警面）。 */
export async function runBillReconcile(
  db: any,
  opts: { fetchImpl?: WxFetch; now?: number; cap?: number } = {}
) {
  const now = opts.now ?? Date.now()
  const date = dayKeyCST(now - DAY_MS) // 前一日（CST）——微信账单约次日 10 点后可下
  const pull = await pullBillDay(db, date, { fetchImpl: opts.fetchImpl })
  if (!pull.ok) {
    const e = pull.error || ''
    if (e === 'NO_WXPAY_CREDS' || e === 'NO_MCHID') {
      // 未配凭证＝功能未启用·非故障：low 面包屑留痕（#14 不静默）但不告警（不打扰）——每日 count++ 可查
      await recordAnomaly('flow-failure', 'BILL_RECON_NOT_CONFIGURED', { fp: 'billReconcile', date, reason: e }, 'low')
      return ok({ date, skipped: 'NOT_CONFIGURED' })
    }
    // 该日无账单（无交易日）＝正常·不告警不落库
    if (e.includes('NO_STATEMENT_EXIST')) return ok({ date, skipped: 'NO_BILL' })
    // 真失败（签名/网络/平台变更）——动作类失败必可观测（#14）：告警后 fail-soft 返回（不抛）
    await notifyAlert('money', 'billReconcile', 'BILL_FETCH_FAIL', { date, fp: date, error: e.slice(0, 120) })
    return ok({ date, error: e.slice(0, 120) })
  }

  // 我方已收款单·宽窗 [date-1d, date+2d)：微信账单归日 vs 我方 paidAt 落库时刻可跨日，窄窗会把
  // 边界真单误判 wxOnly。桩与真云均验的查询形状：多字段隐式 AND + _.gt 单算子 + orderBy/limit，
  // 上界 JS 过滤（桩无 _.and/_.gte·仓内 paging 先例刻意回避）。极端残余（时差>1 日）按 transactionId
  // 全窗匹配已压到「我方单真不存在」一类＝真差异——勿再加宽。
  const _ = db.command
  const dayStart = dayStartMsCST(date)
  const cap = opts.cap ?? 2000
  const raw = await db
    .collection(COLLECTIONS.orders)
    .where({ status: _.in(PAID_ORDER_STATUSES as any), paidAt: _.gt(dayStart - DAY_MS - 1) })
    .orderBy('paidAt', 'desc')
    .limit(cap)
    .get()
    .then((r: any) => r.data)
    .catch(() => [])
  const truncated = raw.length >= cap
  const ourOrders = raw.filter((o: any) => typeof o.paidAt === 'number' && o.paidAt < dayStart + 2 * DAY_MS)

  const { wxOnly, amountMismatch } = matchBillRows(ourOrders, pull.rows)
  if (truncated)
    // 触 cap＝比对面不全：截断假象不当真差异（同 billmatch-approx-flag 纪律）——告警提示扩容，wxOnly 不判
    await notifyAlert('money', 'billReconcile', 'BILL_RECON_TRUNCATED', { date, fp: date, cap })

  // 差异清单（wxOnly 截断时跳过·amountMismatch 是「已匹配到」的单不受截断影响）
  const findings: { code: string; fp: string; ctx: Record<string, unknown> }[] = [
    ...(truncated
      ? []
      : wxOnly.map((w) => ({
          code: 'BILL_WX_ONLY',
          fp: String(w.transactionId || ''),
          ctx: { date, outTradeNo: w.outTradeNo, amount: w.amount },
        }))),
    ...amountMismatch.map((m) => ({
      code: 'BILL_AMOUNT_MISMATCH',
      fp: String(m.transactionId || ''),
      ctx: { date, orderId: m.id, ourAmount: m.ourAmount, wxAmount: m.wxAmount },
    })),
  ]

  // run 级汇总推送前按指纹预读判「有无新差异」：recordAnomaly 指纹去重兜住账本与 [LD_ALERT]，
  // 但 notifyAlert 的 webhook 推送每调必推（无去重）——预检保证同日重跑不重推（#1）。
  // 读放大有界＝差异条数（正常日为 0）；不改 recordAnomaly 返回值（其 void 契约被 anomaly.test.ts 钉死）。
  let fresh = 0
  for (const f of findings) {
    const fp = anomalyFingerprint('invariant-violation', f.code, f.fp)
    const got = await db.collection(COLLECTIONS.anomalies).doc(fp).get().catch(() => null)
    if (!got || !got.data) fresh++
  }
  for (const f of findings)
    await recordAnomaly('invariant-violation', f.code, { fp: f.fp, ...f.ctx }, 'high')
  if (fresh > 0)
    await notifyAlert('money', 'billReconcile', 'BILL_RECON_DISCREPANCY', {
      date,
      fp: date,
      wxOnly: truncated ? 0 : wxOnly.length,
      amountMismatch: amountMismatch.length,
    })

  return ok({
    date,
    bills: pull.count,
    wxOnly: truncated ? 0 : wxOnly.length,
    amountMismatch: amountMismatch.length,
    ...(truncated ? { truncated: true } : {}),
  })
}

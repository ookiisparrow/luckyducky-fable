import { COLLECTIONS, toFen } from '@ldrw/shared'
import { fetchTradeBill, normalizePem, type BillRow, type WxFetch } from './wxpay'
import { getSecureConfigFields } from './secureConfig'

// —— S16 对账原语单源（钱链·批B2）——与 kit/wxpay 分工：wxpay 管微信 v3 出站签名/账单解析
// （平台接缝单点#12），本文件管「拉一日→落库→比对」编排与纯分类器。消费方：adminApi 手动路径
// （downloadBill/getBillMatch）+ timers/billReconcile 每日自动对账——同一套原语，行为单源不双轨。
// CST 日历日助手自 reconciliation.ts 迁出成单源（此前 reconciliation 本地私有·timer 复用则必须上提）。

export const DAY_MS = 86400_000
const CST = 8 * 3600_000 // 东八区·按中国日历日分桶

/** ms 时间戳 → CST 日历日 'YYYY-MM-DD' */
export const dayKeyCST = (ts: number) => new Date(Number(ts) + CST).toISOString().slice(0, 10)
/** 'YYYY-MM-DD' → CST 当日 00:00:00 的 ms */
export const dayStartMsCST = (d: string) => Date.parse(d + 'T00:00:00+08:00')

/** 幂等落库：确定性 _id=`<date>:<transactionId>`（重拉同日覆盖不重复·根因#1）。
 *  先建集合（wxBills 动态建·往不存在的集合 doc().set() 会失败）；只对真写成功的计数（不吞错装成功）。
 *  自 adminApi/actions/wxbill.ts 原样移入（批B2·timer 复用），ensure 改本地 createCollection（kit 不 import functions/）。 */
export async function upsertBills(db: any, date: string, rows: BillRow[]): Promise<number> {
  try {
    await db.createCollection(COLLECTIONS.wxBills) // 集合不存在则建（否则 set 静默失败·count 虚高）
  } catch {
    /* 已存在 */
  }
  let n = 0
  for (const r of rows) {
    if (!r.transactionId) continue
    try {
      await db
        .collection(COLLECTIONS.wxBills)
        .doc(`${date}:${r.transactionId}`)
        .set({ data: { date, ...r, _syncedAt: Date.now() } })
      n++ // 仅真写成功才计
    } catch {
      /* 单行写失败跳过·不阻断其余 */
    }
  }
  return n
}

/**
 * 拉一日微信交易账单 → 落 wxBills。**fail-soft 全程不抛**：凭证缺 {ok:false,error:'NO_WXPAY_CREDS'|'NO_MCHID'}，
 * 拉取失败原样透传 fetchTradeBill 的 error（含 NO_STATEMENT_EXIST 字样＝该日无账单·由调用方分诊）。
 * 凭证链（根因#9）：secureConfig/wxpay 读库优先、env 兜底（**env 是函数进程级**——timer 新函数不继承
 * adminApi 的环境变量，部署侧要么凭证入库要么本函数同配 env，否则每日静默 skipped）；mchid 取 config/pay.subMchId。
 */
export async function pullBillDay(
  db: any,
  date: string,
  opts: { fetchImpl?: WxFetch; billType?: string } = {}
): Promise<{ ok: false; error: string } | { ok: true; count: number; rows: BillRow[] }> {
  const creds = await getSecureConfigFields(db, 'wxpay', ['mchSerial', 'mchPrivateKey'])
  const serial = creds.mchSerial
  // 私钥换行常被控制台塌成空格/字面 \n（→ OpenSSL DECODER 报错）→ 稳健重建规范 PEM（对已规整值幂等，无害）
  const privateKey = normalizePem(creds.mchPrivateKey)
  if (!serial || !privateKey) return { ok: false, error: 'NO_WXPAY_CREDS' }
  const cfg = await db.collection(COLLECTIONS.config).doc('pay').get().catch(() => null)
  const mchid = (cfg && cfg.data && cfg.data.subMchId) || ''
  if (!mchid) return { ok: false, error: 'NO_MCHID' }
  const r = opts.fetchImpl
    ? await fetchTradeBill({ date, mchid: String(mchid), serial, privateKey, billType: opts.billType }, opts.fetchImpl)
    : await fetchTradeBill({ date, mchid: String(mchid), serial, privateKey, billType: opts.billType })
  if (!r.ok) return { ok: false, error: r.error || 'BILL_FETCH_FAIL' }
  const rows = r.rows || []
  const count = await upsertBills(db, date, rows)
  return { ok: true, count, rows }
}

/**
 * 纯分类器（无 IO·金额比对走 toFen 分整数·根因#4）：逐微信 SUCCESS 行按 transactionId/outTradeNo
 * 匹配我方单，三分支：平（matched）/ 微信有我方无（wxOnly·最危险类）/ 金额不符（amountMismatch）。
 * 自 getBillMatch 首环原样提取（app-admin4「外部逐笔对账」characterization 锁行为）；oursOnly
 * （我方有微信无）不在此——需「账单覆盖日」上下文防误报，留 getBillMatch 本地判。
 */
export function matchBillRows(
  ourOrders: any[],
  wxRows: any[]
): {
  matched: string[]
  wxOnly: { transactionId: string; outTradeNo: string; amount: number; date?: string }[]
  amountMismatch: { id: string; transactionId: string; ourAmount: number; wxAmount: number }[]
} {
  const ourByTxn = new Map(ourOrders.map((o: any) => [String(o.transactionId || ''), o]))
  const ourById = new Map(ourOrders.map((o: any) => [String(o.id || ''), o]))
  const matched: string[] = []
  const wxOnly: { transactionId: string; outTradeNo: string; amount: number; date?: string }[] = []
  const amountMismatch: { id: string; transactionId: string; ourAmount: number; wxAmount: number }[] = []
  for (const w of wxRows) {
    if (String(w.tradeState) !== 'SUCCESS') continue // 只比成功收款行（REFUND 等不进比对）
    const our: any =
      ourByTxn.get(String(w.transactionId || '')) || ourById.get(String(w.outTradeNo || ''))
    if (!our) {
      wxOnly.push({
        transactionId: w.transactionId,
        outTradeNo: w.outTradeNo,
        amount: w.orderAmount,
        date: w.date,
      })
      continue
    }
    if (toFen(Number(our.amount) || 0) !== toFen(Number(w.orderAmount) || 0))
      amountMismatch.push({
        id: our.id,
        transactionId: w.transactionId,
        ourAmount: our.amount,
        wxAmount: w.orderAmount,
      })
    else matched.push(our.id)
  }
  return { matched, wxOnly, amountMismatch }
}

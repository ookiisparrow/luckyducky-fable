import { reply, ensure, type Ctx } from '../lib'
import { COLLECTIONS } from '@ldrw/shared'
import { fetchTradeBill, normalizePem, getSecureConfig, type BillRow } from '../../../kit'

// —— S16 外部对账 Batch 2：拉微信交易账单落 wxBills（供 Batch 3 逐笔比对）——
// 凭证（根因#9）：商户私钥/证书序列号经 kit/secureConfig 读库（决策 2026-07-12·/admin 人工配置清单页
// 填写自动生效），DB 无值时回退云开发环境变量（迁移期兼容）；mchid 取 config.pay.subMchId（1113881793）。
// fail-soft：缺凭证 / 拉取失败 → ok:false（不抛·不落库）。出站签名/解析收口 kit/wxpay（守卫 wxpay-seam-single）。

const isDate = (s: any) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)

/** 幂等落库：确定性 _id=`<date>:<transactionId>`（重拉同日覆盖不重复）。导出供守卫直测。
 *  先建集合（wxBills 是新集合·往不存在的集合 doc().set() 会失败）；只对真写成功的计数（不吞错装成功）。 */
export async function upsertBills(db: any, date: string, rows: BillRow[]): Promise<number> {
  await ensure(db, COLLECTIONS.wxBills) // 集合不存在则建（否则 set 静默失败·count 虚高）
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

/** 拉一天微信交易账单 → 落 wxBills。data={ date:'YYYY-MM-DD', billType? }。 */
export async function downloadBill({ db, data }: Ctx) {
  const date = isDate(data?.date) ? data.date : ''
  if (!date) return reply(400, { ok: false, error: 'BAD_DATE' })
  const serial = await getSecureConfig(db, 'wxpay', 'mchSerial')
  // 私钥换行常被控制台塌成空格/字面 \n（→ OpenSSL DECODER 报错）→ 稳健重建规范 PEM（DB 存的已规整过，
  // 这里对 env 兜底路径的原始值仍需要——双跑一遍 normalizePem 对已规整值是幂等的，无害）
  const privateKey = normalizePem(await getSecureConfig(db, 'wxpay', 'mchPrivateKey'))
  if (!serial || !privateKey) return reply(200, { ok: false, error: 'NO_WXPAY_CREDS' })
  const cfg = await db.collection(COLLECTIONS.config).doc('pay').get().catch(() => null)
  const mchid = (cfg && cfg.data && cfg.data.subMchId) || ''
  if (!mchid) return reply(200, { ok: false, error: 'NO_MCHID' })
  const r = await fetchTradeBill({ date, mchid: String(mchid), serial, privateKey, billType: data?.billType })
  if (!r.ok) return reply(200, { ok: false, error: r.error || 'BILL_FETCH_FAIL' })
  const count = await upsertBills(db, date, r.rows || [])
  return reply(200, { ok: true, date, count })
}

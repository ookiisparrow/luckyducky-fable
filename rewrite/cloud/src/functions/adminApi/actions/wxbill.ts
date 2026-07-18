import { reply, type Ctx } from '../lib'
import { pullBillDay } from '../../../kit'

// —— S16 外部对账 Batch 2：拉微信交易账单落 wxBills（供 Batch 3 逐笔比对）——
// 批B2 改薄：凭证读取（secureConfig 读库优先·env 兜底）+ 拉取（kit/wxpay 出站·守卫 wxpay-seam-single）
// + 幂等落库（确定性 _id）全部收口 kit/reconcile.pullBillDay——timers/billReconcile 每日自动对账同一套原语，
// 本 action 只留手动路径的参数校验与 reply 形状。fail-soft：缺凭证 / 拉取失败 → ok:false（不抛·不落库）。

const isDate = (s: any) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)

/** 拉一天微信交易账单 → 落 wxBills。data={ date:'YYYY-MM-DD', billType? }。 */
export async function downloadBill({ db, data }: Ctx) {
  const date = isDate(data?.date) ? data.date : ''
  if (!date) return reply(400, { ok: false, error: 'BAD_DATE' })
  const r = await pullBillDay(db, date, { billType: data?.billType })
  if (!r.ok) return reply(200, { ok: false, error: r.error })
  return reply(200, { ok: true, date, count: r.count })
}

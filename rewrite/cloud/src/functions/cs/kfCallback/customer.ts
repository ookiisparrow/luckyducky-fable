import { COLLECTIONS } from '@ldrw/shared'
import { csTestAssumeRecentOrder } from '../../../kit'
import { docData } from './store'

// ── 身份桥接（external_userid → openid）+ 订单摘要 ──
/** 查映射表得 openid（不信前端·根因#3：映射由 kfBind 在小程序侧建）。未绑定返 null。 */
export async function resolveOpenid(db: any, externalUserId: string): Promise<string | null> {
  if (!externalUserId) return null
  const d = await docData(db, COLLECTIONS.kfIdentity, 'ext:' + externalUserId)
  return d && d.openid ? String(d.openid) : null
}

/** 会话内回「你的订单」摘要（实时查·零幻觉）：取最近 3 单状态。 */
export async function summarizeOrders(db: any, openid: string): Promise<string> {
  const r = await db
    .collection(COLLECTIONS.orders)
    .where({ _openid: openid })
    .orderBy('createdAt', 'desc')
    .limit(3)
    .get()
    .catch(() => null)
  if (!r) return '订单暂时查不到，请稍后再试，或点「转人工」。' // 库挂 ≠ 名下没有订单（根因#14）
  const list = (r && r.data) || []
  if (!list.length) return '没查到你名下的订单。如果刚下单可稍后再试，或点「转人工」。'
  // refund_required 用词对齐 admin/src/lib/format.ts 的选择："待退款"而非"退款处理中"（后者与售后 approved 状态撞车，见该文件同款注释）
  const STAT: Record<string, string> = { pending: '待支付', paid: '已支付/待发货', shipped: '已发货', refund_required: '待退款', payment_exception: '支付异常待处理', done: '已完成', closed: '已关闭' }
  // 运单号在 shipping 子对象（发货时 adminApi 写 shipping:{company,trackingNo}）——取顶层 o.trackingNo 会永远显示不出（根因#8）
  const lines = list.map((o: any) => {
    const tracking = o.shipping && o.shipping.trackingNo
    return `· 订单 ${o.id || o._id}：${STAT[o.status] || o.status}${tracking ? '（运单 ' + tracking + '）' : ''}`
  })
  return '你最近的订单：\n' + lines.join('\n') + '\n需要更多帮助点「转人工」。'
}

/** 与 summarizeOrders 同口径：最近 3 单。库挂返 null（根因#14：库挂 ≠ 没单）。 */
export async function hasRecentOrders(db: any, openid: string): Promise<boolean | null> {
  const r = await db
    .collection(COLLECTIONS.orders)
    .where({ _openid: openid })
    .orderBy('createdAt', 'desc')
    .limit(3)
    .get()
    .catch(() => null)
  if (!r) return null
  return ((r.data || []).length > 0)
}

/**
 * 客服用户有没有近期订单。未绑定=无单；库挂当有单（不误走无单澄清）。测版默认假设有单。
 * knownOpenid：调用方已读过该顾客映射时传入（'' = 已知未绑定），不传才在此读。
 */
export async function kfUserHasRecentOrder(db: any, euid: string, knownOpenid?: string): Promise<boolean> {
  if (csTestAssumeRecentOrder()) return true
  const openid = knownOpenid ?? (await resolveOpenid(db, euid))
  if (!openid) return false
  const hit = await hasRecentOrders(db, openid)
  return hit !== false
}

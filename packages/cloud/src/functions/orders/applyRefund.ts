import { toFen, asFen, fenToYuan } from '@luckyducky/shared'
import { withOpenId, ok, err } from '../../kit'

// 申请售后退款（敏感：退款金额一律云端分摊算定，不信任前端）。闸门（链10）：openid 本人 +
// 订单 paid/shipped/done + 商品在单内 + 条目 refundable（进课即失，链6）+ 一单一品一售后
//（确定性 _id=orderId__productId 库级唯一）+ 同单累计 ≤ 实付。审核打款在控制台（adminApi）。
export const main = withOpenId(async ({ db, OPENID, event }) => {
  const e: any = event
  const orderId = String(e.orderId || '')
  // 行键（外审 P1.1·根因#1）：前端传 lineId（新单 productId__spec）；兼容旧单/旧前端传 productId（回退）
  const reqLine = String(e.lineId || e.productId || '')
  if (!orderId || !reqLine) return err('BAD_ARGS')
  const reason = String(e.reason || '').slice(0, 200)

  const got = await db.collection('orders').doc(orderId).get().catch(() => null)
  if (!got || !got.data || got.data._openid !== OPENID) return err('NOT_FOUND')
  const order = got.data
  if (!['paid', 'shipped', 'done'].includes(order.status)) return err('BAD_STATUS:' + order.status)

  // 有效行键：新单 item.lineId / 旧单回退 productId（两端一致·外审 P1.1）——同商品多 SKU 各自定位、不再撞行
  const item = (order.items || []).find((it: any) => (it.lineId || it.productId) === reqLine)
  if (!item) return err('UNKNOWN_ITEM:' + reqLine)
  if (item.refundable === false) return err('NOT_REFUNDABLE') // 进课即失退货权
  const lineId = item.lineId || item.productId // 落库/确定性 _id 用有效键（旧单=productId·兼容）
  const productId = item.productId // 课程/激活仍按 productId（一商品对一课程）

  // 分摊全程 shared Fen（分整数，根因#4：asFen 对非整数分抛错＝脏数据 tripwire）；同单已占额度（申请中/已同意/已退）不可重复退
  const amountFen = toFen(Number(order.amount))
  const goodsFen = toFen(Number(order.goods))
  const itemFen = asFen(toFen(item.price) * item.qty)
  const share = goodsFen > 0 ? asFen(Math.min(amountFen, Math.round((amountFen * itemFen) / goodsFen))) : asFen(0)

  await db.createCollection('afterSales').catch(() => {})
  const exist = await db.collection('afterSales').where({ orderId }).get().catch(() => ({ data: [] }))
  // 一单一行一售后：同行已有记录（含已拒绝，v1 拒后重申走人工）→ 先于额度判定报已申请。
  // 按有效行键查重（兼容旧售后记录无 lineId·回退 productId·外审 P1.1）——同商品不同 SKU 是不同行，可各自申请。
  if (exist.data.some((a: any) => (a.lineId || a.productId) === lineId)) return err('ALREADY_APPLIED')
  const used = asFen(
    exist.data
      .filter((a: any) => ['applied', 'approved', 'refunded'].includes(a.status))
      .reduce((s: number, a: any) => s + toFen(Number(a.refundAmount)), 0)
  )
  const refundFen = asFen(Math.min(share, Math.max(0, amountFen - used)))
  if (refundFen <= 0) return err('NOTHING_LEFT')

  const now = Date.now()
  const rec = {
    _id: orderId + '__' + lineId,
    orderId,
    _openid: OPENID,
    lineId,
    productId,
    name: item.name,
    spec: item.spec || '',
    qty: item.qty,
    itemTotal: fenToYuan(itemFen),
    refundAmount: fenToYuan(refundFen),
    reason,
    addressName: (order.address && order.address.name) || '',
    phone: (order.address && order.address.phone) || '',
    status: 'applied',
    appliedAt: now,
  }
  try {
    await db.collection('afterSales').add({ data: rec })
  } catch {
    return err('ALREADY_APPLIED') // 库级唯一：一单一品一售后
  }
  return ok({ afterSale: rec })
})

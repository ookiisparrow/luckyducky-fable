// 申请售后退款（敏感业务：退款金额一律云端分摊算定，不信任前端）。
// 闸门（链10）：openid 本人 + 订单 paid/shipped/done + 商品在单内 + 条目 refundable
// （确认进课即失，链6）+ 一单一品一售后（_id=orderId__productId 库级唯一）+ 同单累计 ≤ 实付。
// 金额分摊：refundFen = min(剩余可退, round(实付分 × 条目小计 / 商品总额))——占位券按比例摊，
// 单品订单即全额实付。审核与打款在控制台（adminApi.approveRefund → 退款工作流）。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return { ok: false, error: 'NO_OPENID' }
  const orderId = String(event.orderId || '')
  const productId = String(event.productId || '')
  if (!orderId || !productId) return { ok: false, error: 'BAD_ARGS' }
  const reason = String(event.reason || '').slice(0, 200)

  const got = await db.collection('orders').doc(orderId).get().catch(() => null)
  if (!got || !got.data || got.data._openid !== OPENID) return { ok: false, error: 'NOT_FOUND' }
  const order = got.data
  if (!['paid', 'shipped', 'done'].includes(order.status)) {
    return { ok: false, error: 'BAD_STATUS:' + order.status }
  }

  const item = (order.items || []).find((it) => it.productId === productId)
  if (!item) return { ok: false, error: 'UNKNOWN_ITEM:' + productId }
  if (item.refundable === false) return { ok: false, error: 'NOT_REFUNDABLE' } // 进课即失退货权

  // 分摊用「分」运算避免浮点误差；同单已占用额度（申请中/已同意/已退）不可重复退
  const amountFen = Math.round(Number(order.amount) * 100)
  const goodsFen = Math.round(Number(order.goods) * 100)
  const itemFen = Math.round(item.price * 100) * item.qty
  const share = goodsFen > 0 ? Math.min(amountFen, Math.round((amountFen * itemFen) / goodsFen)) : 0

  await db.createCollection('afterSales').catch(() => {})
  const exist = await db.collection('afterSales').where({ orderId }).get().catch(() => ({ data: [] }))
  // 一单一品一售后：同条目已有记录（含已拒绝，v1 拒后重申走人工）→ 先于额度判定报已申请
  if (exist.data.some((a) => a.productId === productId)) return { ok: false, error: 'ALREADY_APPLIED' }
  const used = exist.data
    .filter((a) => ['applied', 'approved', 'refunded'].includes(a.status))
    .reduce((s, a) => s + Math.round(Number(a.refundAmount) * 100), 0)
  const refundFen = Math.min(share, Math.max(0, amountFen - used))
  if (refundFen <= 0) return { ok: false, error: 'NOTHING_LEFT' }

  const now = Date.now()
  const rec = {
    _id: orderId + '__' + productId,
    orderId,
    _openid: OPENID,
    productId,
    name: item.name,
    spec: item.spec || '',
    qty: item.qty,
    itemTotal: itemFen / 100,
    refundAmount: refundFen / 100,
    reason,
    addressName: (order.address && order.address.name) || '',
    phone: (order.address && order.address.phone) || '',
    status: 'applied',
    appliedAt: now,
  }
  try {
    await db.collection('afterSales').add({ data: rec })
  } catch {
    return { ok: false, error: 'ALREADY_APPLIED' } // 库级唯一：一单一品一售后
  }
  return { ok: true, afterSale: rec }
}

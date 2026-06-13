import { withOpenId, ok, err } from '../../kit'

// 按单号取本人订单（详情兜底：getMyOrders 固定 limit 外的老单也能打开）。
// openid 闸 + 归属校验：他人订单 NOT_FOUND（不泄露存在性）。
export const main = withOpenId(async ({ db, OPENID, event }) => {
  const id = String(event.id || '')
  if (!id) return err('NO_ID')
  const got = await db
    .collection('orders')
    .doc(id)
    .get()
    .catch(() => null)
  if (!got || !got.data || got.data._openid !== OPENID) return err('NOT_FOUND')
  return ok({ order: got.data })
})

import { withOpenId, ok } from '../../kit'

// 取本人订单列表（倒序）。openid 取自 getWXContext，只见自己的单。
// 试点：openid 闸样板由 kit.withOpenId 收编（原 cloudfunctions/getMyOrders 的 4 行 init+闸消失）。
// limit 100 为审核批次B 临时缓解；分页体系 B5 接 kit.paging（根因账本 #7）。
export const main = withOpenId(async ({ db, OPENID }) => {
  const res = await db
    .collection('orders')
    .where({ _openid: OPENID })
    .orderBy('createdAt', 'desc')
    .limit(100)
    .get()
  return ok({ list: res.data })
})

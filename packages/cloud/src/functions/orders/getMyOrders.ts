import { withOpenId, ok, pageQuery } from '../../kit'

// 取本人订单列表（游标分页，根因账本 #7：固定 limit 规模即挤出）。
// 无参=首页 100（兼容旧前端读 .list）；前端用 nextCursor 渐进翻页取全量。
export const main = withOpenId(async ({ db, OPENID, event }) => {
  const paged = await pageQuery(db, 'orders', { _openid: OPENID }, 'createdAt', event, 100)
  return ok({ ...paged })
})

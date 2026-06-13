import { withOpenId, ok } from '../../kit'

// 我的售后单（只读本人）：按申请时间倒序（售后页进度列表用）。
export const main = withOpenId(async ({ db, OPENID }) => {
  const res = await db
    .collection('afterSales')
    .where({ _openid: OPENID })
    .orderBy('appliedAt', 'desc')
    .limit(50)
    .get()
    .catch(() => ({ data: [] }))
  return ok({ list: res.data })
})

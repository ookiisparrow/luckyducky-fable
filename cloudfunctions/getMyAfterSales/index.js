// 我的售后单（只读本人）：openid 闸门，按申请时间倒序（售后页进度列表用）。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async () => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return { ok: false, error: 'NO_OPENID' }
  const res = await db
    .collection('afterSales')
    .where({ _openid: OPENID })
    .orderBy('appliedAt', 'desc')
    .limit(50)
    .get()
    .catch(() => ({ data: [] }))
  return { ok: true, list: res.data }
}

// 取当前用户已解锁的课程（规格 §四-4，2026-06-10 细化）：
// 只返回已确认（enteredAt 非空）的激活记录——确认是进课的唯一闸门。
// 同课多码（买两只鸭）按 courseId 去重，取最早 enteredAt。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async () => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return { ok: false, error: 'NO_OPENID' }
  const res = await db
    .collection('activations')
    .where({ _openid: OPENID, enteredAt: _.neq(null) })
    .get()
  const byCourse = {}
  for (const a of res.data) {
    if (!byCourse[a.courseId] || a.enteredAt < byCourse[a.courseId].enteredAt) {
      byCourse[a.courseId] = { courseId: a.courseId, enteredAt: a.enteredAt }
    }
  }
  return { ok: true, list: Object.values(byCourse) }
}

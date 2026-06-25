import { withOpenId, ok } from '../../kit'

// 取本人已解锁课程：只返回已确认（enteredAt 非空）的激活——确认是进课唯一闸门。
// 同课多码（买两只鸭）按 courseId 去重，取最早 enteredAt。
export const main = withOpenId(async ({ db, OPENID }) => {
  const _ = db.command
  const res = await db
    .collection('activations')
    .where({ _openid: OPENID, enteredAt: _.neq(null) })
    .limit(200) // 显式上界（规模·根因#7）：本人激活远不及 200·防裸 .get() 默认 100 静默截断漏课
    .get()
  const byCourse: Record<string, { courseId: string; enteredAt: number }> = {}
  for (const a of res.data) {
    if (!byCourse[a.courseId] || a.enteredAt < byCourse[a.courseId].enteredAt) {
      byCourse[a.courseId] = { courseId: a.courseId, enteredAt: a.enteredAt }
    }
  }
  return ok({ list: Object.values(byCourse) })
})

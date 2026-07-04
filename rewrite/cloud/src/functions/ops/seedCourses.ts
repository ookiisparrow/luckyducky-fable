import { withAdminGate, ok } from '../../kit'
import { SEED_COURSES } from '@ldrw/shared'

// 灌入课程种子（三层；幂等：course id 作 _id，doc.set upsert）。
// canonical 种子在 @luckyducky/shared（根因#5，与 miniapp data/course 同源，esbuild 内联）。
// 管理闸（kit.withAdminGate）：CLI/控制台 invoke 无 openid 放行；客户端须 users.isAdmin。
export const main = withAdminGate(async ({ db }) => {
  const ids: string[] = []
  for (const c of SEED_COURSES) {
    await db
      .collection('courses')
      .doc(c.id)
      .set({ data: { ...c, updatedAt: db.serverDate() } })
    ids.push(c.id)
  }
  return ok({ count: ids.length, ids })
})

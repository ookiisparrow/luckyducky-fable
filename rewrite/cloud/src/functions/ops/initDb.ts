import { withAdminGate, ok } from '../../kit'
import { COLLECTIONS } from '@ldrw/shared'

// 一次性建库：创建集合（已存在则忽略）。清单引 kit COLLECTIONS **单源**（根因#5——原硬编码 8 个集合的
// 老清单早已漂移·现实 30；集合动态建=「首写才出现→控制台锁不了权限」的窗口期，加新集合后 invoke 本函数
// 即建齐缺失集合、立刻可锁）。管理闸（kit.withAdminGate）：CLI/控制台 invoke 无 openid 放行；客户端须 users.isAdmin。
export const main = withAdminGate(async ({ db }) => {
  const result: Record<string, string> = {}
  for (const name of Object.values(COLLECTIONS)) {
    try {
      await db.createCollection(name)
      result[name] = 'created'
    } catch {
      result[name] = 'exists_or_skip' // 已存在（errCode -501001 等）→ 忽略
    }
  }
  return ok({ result })
})

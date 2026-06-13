import { withAdminGate, ok } from '../../kit'

// 一次性建库：创建集合（已存在则忽略）。trackEvent 也会按需自建，这里列全便于对账。
// 管理闸（kit.withAdminGate）：CLI/控制台 invoke 无 openid 放行；客户端须 users.isAdmin。
const COLLECTIONS = ['users', 'products', 'courses', 'orders', 'qrcodes', 'activations', 'events', 'progress']

export const main = withAdminGate(async ({ db }) => {
  const result: Record<string, string> = {}
  for (const name of COLLECTIONS) {
    try {
      await db.createCollection(name)
      result[name] = 'created'
    } catch {
      result[name] = 'exists_or_skip' // 已存在（errCode -501001 等）→ 忽略
    }
  }
  return ok({ result })
})

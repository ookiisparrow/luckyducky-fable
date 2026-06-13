import { withAdminGate, ok } from '../../kit'
import { SEED_PRODUCTS } from '@luckyducky/shared'

// 灌入商品种子（幂等：业务 id 作 _id，doc.set upsert）。
// canonical 种子在 @luckyducky/shared（根因#5，与 miniapp data/catalog 同源，esbuild 内联）。
// 管理闸（kit.withAdminGate）：CLI/控制台 invoke 无 openid 放行；客户端须 users.isAdmin。
export const main = withAdminGate(async ({ db }) => {
  const ids: string[] = []
  for (const p of SEED_PRODUCTS) {
    await db
      .collection('products')
      .doc(p.id)
      .set({ data: { ...p, updatedAt: db.serverDate() } })
    ids.push(p.id)
  }
  return ok({ count: ids.length, ids })
})

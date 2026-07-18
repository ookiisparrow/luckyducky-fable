import { withAdminGate, ok } from '../../kit'
import { SEED_PRODUCTS } from '@ldrw/shared'

// 灌入商品种子（幂等：业务 id 作 _id，doc.set upsert）。
// canonical 种子在 @luckyducky/shared（根因#5，与 miniapp data/catalog 同源，esbuild 内联）。
// 管理闸（kit.withAdminGate）：CLI/控制台 invoke 无 openid 放行；客户端须 users.isAdmin。
// ⚠️ 本函数整份覆写 products.cover/images，游离于批B 商品图 GC 判据（products.ts diffOrphans）之外——
// 一次性灌种工具、不调 deleteFile 无误删风险；若生产环境对已自定义图的商品重跑，被覆盖的旧图不入 GC 队（刻意不为一次性工具建机制）。
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

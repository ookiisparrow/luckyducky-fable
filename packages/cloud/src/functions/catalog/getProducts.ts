import { getDb, ok } from '../../kit'

// 取商品列表（按 sort 升序）。只读、非敏感；价格一律以云端为准（CLAUDE §14）。
// catalog 域；kit.getDb 收编 cloud.init 样板（根因#5）。本函数亦作 B2 回灌探针
// （esbuild 产物 tcb 兼容验证，见 scripts/verify-cloud-bundles.cjs 与重构日志）。
export const main = async () => {
  const db = getDb()
  const res = await db.collection('products').orderBy('sort', 'asc').get()
  return ok({ list: res.data })
}

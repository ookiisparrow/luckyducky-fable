// 取商品列表（按 sort 升序）。前端 api/shop.js 调用。
// 只读、非敏感；价格等一律以云端为准，不信任前端传入（见 CLAUDE.md §14）。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async () => {
  const res = await db.collection('products').orderBy('sort', 'asc').get()
  return { ok: true, list: res.data }
}

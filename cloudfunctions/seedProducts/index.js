// 一次性灌入商品种子数据。部署后调用一次即可；再次调用也安全（幂等）。
// 幂等原理：用业务 id（prod-1…）作为文档 _id，doc(id).set 是 upsert——
// 记录存在则整体覆盖、不存在则创建，所以重复 seed 不会产生重复数据。
//
// ⚠️ 这份种子要与前端 src/data/catalog.js 保持一致：
//    catalog.js 是 H5 / App 端的本地回退源，这里是小程序端的云端真源，两边字段同形。
//    商品身份字段：id / name / tag / price（现价·数字）/ was（划线价·数字）。
//    featured = 是否首页横滑展示；sort = 列表排序（升序）。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// courseId = 配套课程（confirmEnter 退货权启发匹配靠它反查）；课程未上线为 null
const PRODUCTS = [
  { id: 'prod-1', name: '幸运小鸭礼盒', tag: '送礼首选', price: 198, was: 258, featured: true, sort: 0, courseId: 'course-duck' },
  { id: 'prod-2', name: '进阶套装 · 小伙伴们', tag: '4 只装', price: 399, was: 499, featured: true, sort: 1, courseId: null },
  { id: 'prod-3', name: '微笑小鸡 · 入门', tag: '零基础首选', price: 128, was: 168, featured: true, sort: 2, courseId: null },
  { id: 'prod-4', name: '幸运小鸭 · 单只', tag: '单只装', price: 98, was: 138, featured: false, sort: 3, courseId: 'course-duck' },
  { id: 'prod-5', name: '云朵小羊 · 入门', tag: '入门首选', price: 148, was: 198, featured: false, sort: 4, courseId: null },
]

exports.main = async () => {
  // 管理闸（与 genQrcodes 同模式）：CLI / 控制台 invoke 无 openid 放行；
  // 小程序端任意登录用户调用须 users.isAdmin，否则拒——防客户端覆盖生产商品数据。
  const { OPENID } = cloud.getWXContext()
  if (OPENID) {
    const u = await db.collection('users').where({ _openid: OPENID }).get()
    if (!u.data.length || u.data[0].isAdmin !== true) return { ok: false, error: 'ADMIN_ONLY' }
  }

  const ids = []
  for (const p of PRODUCTS) {
    await db
      .collection('products')
      .doc(p.id)
      .set({ data: { ...p, updatedAt: db.serverDate() } })
    ids.push(p.id)
  }
  return { ok: true, count: ids.length, ids }
}

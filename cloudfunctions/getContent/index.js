// 取首页内容（hero 文案/信任条/FAQ；控制台「小程序橱窗」编辑，存 content 集合 doc 'home'）。
// 只读、非敏感；无记录返回 null（前端回退本地默认文案）。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async () => {
  try {
    const got = await db.collection('content').doc('home').get()
    return { ok: true, home: got.data || null }
  } catch {
    return { ok: true, home: null } // 集合/文档未建 = 用默认文案
  }
}

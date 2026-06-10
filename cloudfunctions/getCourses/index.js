// 取课程列表（三层结构，按 sort 升序）。前端 api/course.js 调用。
// 只读、非敏感（课程目录公开可见）；激活权限（getMyCourses）在 P3 另做，
// 播放鉴权与 videoFileId 换临时 URL 届时一并上（见 设计规格 §四）。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async () => {
  const res = await db.collection('courses').orderBy('sort', 'asc').get()
  return { ok: true, list: res.data }
}

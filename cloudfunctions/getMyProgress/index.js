// 我的学习进度（紧凑文档，trackEvent 折叠写入；目录角标 / 继续学习卡读这里）。
// openid 取 getWXContext，只返回本人记录。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async () => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return { ok: false, error: 'NO_OPENID' }
  try {
    const res = await db.collection('progress').where({ _openid: OPENID }).get()
    return { ok: true, list: res.data }
  } catch {
    return { ok: true, list: [] } // 集合未建 = 还没有任何进度
  }
}

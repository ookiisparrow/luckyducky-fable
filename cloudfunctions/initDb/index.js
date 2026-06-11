// 一次性建库:创建集合(已存在则忽略)。部署后手动调用一次即可。
// events / progress 2026-06-11 加(埋点 + 进度);trackEvent 也会按需自建,这里列全便于对账。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const COLLECTIONS = [
  'users',
  'products',
  'courses',
  'orders',
  'qrcodes',
  'activations',
  'events',
  'progress',
]

exports.main = async () => {
  // 管理闸（与 genQrcodes 同模式）：CLI / 控制台 invoke 无 openid 放行；
  // 小程序端任意登录用户调用须 users.isAdmin。建集合本身无破坏性，加闸是一致性兜底。
  const { OPENID } = cloud.getWXContext()
  if (OPENID) {
    const u = await db.collection('users').where({ _openid: OPENID }).get()
    if (!u.data.length || u.data[0].isAdmin !== true) return { ok: false, error: 'ADMIN_ONLY' }
  }

  const result = {}
  for (const name of COLLECTIONS) {
    try {
      await db.createCollection(name)
      result[name] = 'created'
    } catch {
      // 已存在(errCode -501001 等)→ 忽略
      result[name] = 'exists_or_skip'
    }
  }
  return { ok: true, result }
}

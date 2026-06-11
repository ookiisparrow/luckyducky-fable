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

// 保存用户资料（敏感业务：前端禁直写 users，一律走这里）。
// 安全底座（见 CLAUDE.md §14 / 规格 §三）：
//   - openid 取自 getWXContext，不信任前端传入；只改本人那条 users 记录。
//   - 只收白名单字段 { nickname, avatar, bio }：均须字符串并截断长度；
//     avatar 只接受云存储 fileID（cloud:// 开头，由本人上传）或空串（清除）。
//   - 时间戳存 epoch 毫秒（与 orders 同约定，避免 serverDate 序列化问题）。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const CAPS = { nickname: 20, bio: 60, avatar: 256 }

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return { ok: false, error: 'NO_OPENID' }

  const patch = {}
  if (typeof event.nickname === 'string' && event.nickname.trim()) {
    patch.nickname = event.nickname.trim().slice(0, CAPS.nickname)
  }
  if (typeof event.bio === 'string') {
    patch.bio = event.bio.trim().slice(0, CAPS.bio)
  }
  if (
    typeof event.avatar === 'string' &&
    (event.avatar === '' || event.avatar.startsWith('cloud://'))
  ) {
    patch.avatar = event.avatar.slice(0, CAPS.avatar)
  }
  if (!Object.keys(patch).length) return { ok: false, error: 'EMPTY_PATCH' }
  patch.updatedAt = Date.now()

  // 先查后改（不用 where().update 的 stats 判断建档与否：内容未变化时 updated 为 0，
  // 误判会重复建档）。正常流程 login 已建档，add 只是兜底。
  const users = db.collection('users')
  const found = await users.where({ _openid: OPENID }).get()
  if (found.data.length) {
    const doc = found.data[0]
    await users.doc(doc._id).update({ data: patch })
    return { ok: true, user: { ...doc, ...patch } }
  }
  const doc = { _openid: OPENID, nickname: '', avatar: '', bio: '', createdAt: Date.now(), ...patch }
  const addRes = await users.add({ data: doc })
  return { ok: true, user: { _id: addRes._id, ...doc } }
}

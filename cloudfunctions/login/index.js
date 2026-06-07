// 微信登录(静默):用可信 openid upsert users,返回用户。前端无需传任何身份。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async () => {
  const { OPENID } = cloud.getWXContext()
  const users = db.collection('users')
  const found = await users.where({ _openid: OPENID }).get()
  if (found.data.length) {
    return { ok: true, isNew: false, user: found.data[0] }
  }
  // 新用户建档。注意:云函数是管理端,add 不会自动写 _openid,必须显式写入(否则查不回)。
  const doc = { _openid: OPENID, nickname: '', avatar: '', phone: '', createdAt: db.serverDate() }
  const addRes = await users.add({ data: doc })
  return {
    ok: true,
    isNew: true,
    user: { _id: addRes._id, _openid: OPENID, nickname: '', avatar: '', phone: '' },
  }
}

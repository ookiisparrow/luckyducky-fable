import { withOpenId, ok } from '../../kit'

// 微信登录（静默）：用可信 openid upsert users，返回用户。前端无需传身份。
// 无 openid 无法建立身份 → NO_OPENID（withOpenId 缺省，较原「裸用空 openid」更正确）。
export const main = withOpenId(async ({ db, OPENID }) => {
  const users = db.collection('users')
  const found = await users.where({ _openid: OPENID }).get()
  if (found.data.length) return ok({ isNew: false, user: found.data[0] })
  // 新用户建档：云函数是管理端，add 不自动写 _openid，必须显式写入（否则查不回）。
  const doc = { _openid: OPENID, nickname: '', avatar: '', phone: '', createdAt: db.serverDate() }
  const addRes = await users.add({ data: doc })
  return ok({
    isNew: true,
    user: { _id: addRes._id, _openid: OPENID, nickname: '', avatar: '', phone: '' },
  })
})

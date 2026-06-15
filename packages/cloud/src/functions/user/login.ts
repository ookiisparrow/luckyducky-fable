import { withOpenId, withRateLimit, ok, ensureDoc } from '../../kit'

// 微信登录（静默）：用可信 openid upsert users，返回用户。前端无需传身份。
// 无 openid 无法建立身份 → NO_OPENID（withOpenId 缺省，较原「裸用空 openid」更正确）。
// 建档用确定性 _id=OPENID（根因#1）：并发首登撞号即幂等、不重复建档；老随机 _id 档 where 命中即用。
export const main = withOpenId(
  // 频控（根因#13）：login 幂等但仍是写+调用成本，单用户 30 次/分远超正常启动，超即拒
  withRateLimit('login', { max: 30, windowMs: 60_000 }, async ({ db, OPENID }) => {
    const users = db.collection('users')
    const found = await users.where({ _openid: OPENID }).get()
    if (found.data.length) return ok({ isNew: false, user: found.data[0] })
    // 新用户建档：云函数是管理端，add 不自动写 _openid，必须显式写入（否则查不回）。
    const user = await ensureDoc('users', OPENID, {
      _openid: OPENID,
      nickname: '',
      avatar: '',
      phone: '',
      createdAt: db.serverDate(),
    })
    return ok({ isNew: true, user })
  })
)

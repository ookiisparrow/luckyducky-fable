import { withOpenId, withRateLimit, ok, ensureDoc, currentUnionId } from '../../kit'
import { createHash } from 'crypto'

// 微信登录（静默）：用可信 openid upsert users，返回用户。前端无需传身份。
// 无 openid 无法建立身份 → NO_OPENID（withOpenId 缺省，较原「裸用空 openid」更正确）。
// 建档用确定性 _id=OPENID（根因#1）：并发首登撞号即幂等、不重复建档；老随机 _id 档 where 命中即用。
export const main = withOpenId(
  // 频控（根因#13）：login 幂等但仍是写+调用成本，单用户 30 次/分远超正常启动，超即拒
  withRateLimit('login', { max: 30, windowMs: 60_000 }, async ({ db, OPENID }) => {
    const users = db.collection('users')
    const found = await users.where({ _openid: OPENID }).get()
    const isNew = !found.data.length
    // 新用户建档：云函数是管理端，add 不自动写 _openid，必须显式写入（否则查不回）。
    const user = isNew
      ? await ensureDoc('users', OPENID, { _openid: OPENID, nickname: '', avatar: '', phone: '', createdAt: db.serverDate() })
      : found.data[0]
    // 客服身份桥接（§查订单·根因#3 不信前端·best-effort 绝不反噬登录）：小程序绑开放平台后有 unionid，存进 users；
    // kfCallback 收到客服消息时用微信客服 `kf/customer/batchget` 反查 external_userid→unionid→openid 查订单
    // （不用客户联系 idconvert·那条撞 48002 墙·改走平台原生的微信客服顾客接口）。login 只存 unionid、不调外部 API。
    await storeUnionId(db, OPENID, user).catch(() => {})
    return ok({ isNew, user })
  })
)

// best-effort 存 unionid 到 users（§查订单·不反噬登录）：供 kfCallback batchget 反查 openid。无 unionid / 已存过即跳。
async function storeUnionId(db: any, OPENID: string, user: any): Promise<void> {
  const unionid = currentUnionId()
  // 观测（无 PII·根因#8）：hasUnionid=登录拿没拿到 unionid；uh=unionid 短哈希（不可逆·临时诊断·比对两端 unionid 是否同源·查订单桥接 AB 续查）
  const uh = unionid ? createHash('sha256').update(unionid).digest('hex').slice(0, 8) : '-'
  console.log('[login-bind]', { hasUnionid: !!unionid, uh })
  if (!unionid || (user && user.unionid === unionid)) return // 无 unionid / 已存过：跳
  await db.collection('users').doc(OPENID).update({ data: { unionid } }).catch(() => {})
}

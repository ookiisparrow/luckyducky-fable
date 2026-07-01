import { withOpenId, withRateLimit, ok, ensureDoc, currentUnionId, getCachedKfToken, unionidToExternalUserid, COLLECTIONS } from '../../kit'

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
    // 客服身份桥接（§P0 链②·根因#3 不信前端·best-effort 绝不反噬登录）：小程序绑微信开放平台后有 unionid，
    // 首次（未绑过·当前有活跃客服会话身份时）经企业微信 idconvert 建 external_userid→openid 映射，供客服会话查订单
    // （kfCallback 读 kfIdentity）。复用 kfCallback 缓存的令牌（login 不持密钥·getCachedKfToken）；取不到就跳过下次再试。
    await bindKfIdentity(db, OPENID, user).catch(() => {})
    return ok({ isNew, user })
  })
)

// best-effort 客服身份桥接（§P0 链②·不反噬登录）：已绑过（kfBound）或无 unionid/缓存令牌/48h 会话身份即跳过。
async function bindKfIdentity(db: any, OPENID: string, user: any): Promise<void> {
  const unionid = currentUnionId()
  if (!unionid || (user && user.kfBound)) return
  const token = await getCachedKfToken(db)
  if (!token) return
  const ext = await unionidToExternalUserid(token, unionid, OPENID)
  if (!ext) return // 无 48h 会话身份/转换失败：不写、下次登录再试
  await db.collection(COLLECTIONS.kfIdentity).doc('ext:' + ext).set({ data: { openid: OPENID, unionid, updatedAt: Date.now() } })
  await db.collection('users').doc(OPENID).update({ data: { kfBound: true } }).catch(() => {})
}

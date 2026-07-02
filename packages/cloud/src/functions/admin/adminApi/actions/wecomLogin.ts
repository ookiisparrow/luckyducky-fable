import { reply, sha, str, capsForRole } from '../lib'
import { getCachedKfToken, getWecomOAuthUserId } from '../../../../kit'
import { randomBytes } from 'node:crypto'

// M⑦ 车道 B·企业微信自建应用内 OAuth 免登（承面C 增强·工单 §2.2）。
//
// 定位＝pre-auth（坐席无口令·index.ts 特殊分发·在能力闸前·同 login 受认证频控）：企微内打开应用 → snsapi_base
// 静默授权拿 code → 本 action 换 userid → 反查绑定账号（M⑦ 地基填的 wecomUserId）→ 签发服务端 session 令牌，
// 之后请求以令牌作 key（checkKey.resolveWecomSession 认它·同口令闸的 fail-closed 语义）。
//
// fail-closed（守卫 wecom-login-gated·根因#3 信任边界）：无 code / OAuth 换不到 userid / userid 未绑定账号 /
// 账号停用 / 无缓存令牌 → 一律拒、绝不签发令牌。令牌不持密钥（复用 kfCallback/探针维护的缓存令牌·根因#3 密钥不扩散）。

const SESSION_TTL_MS = 12 * 60 * 60 * 1000 // 12h·一个工作班次；过期后企微内静默 OAuth 重签（snsapi_base 无感）

export async function loginByWecomCode({ db, data }: { db: any; data: any }) {
  const code = str((data && data.code) || '', 512).trim()
  if (!code) return reply(400, { ok: false, error: 'BAD_ARGS' })
  // 令牌不持密钥：复用缓存令牌做 OAuth 换取（根因#3）。缓存空（kfCallback/探针近期无活动）→ 客户端可回退口令或重试。
  const token = await getCachedKfToken(db)
  if (!token) return reply(503, { ok: false, error: 'KF_TOKEN_UNAVAILABLE' })
  const userid = await getWecomOAuthUserId(token, code)
  if (!userid) return reply(401, { ok: false, error: 'BAD_CODE' }) // code 失效 / 非企业成员（返 openid 非 userid）
  // 反查绑定账号（超管 auth 或外包 agent·wecomUserId 唯一·M⑦ 地基唯一性已保证）
  const hit = await db.collection('adminConfig').where({ wecomUserId: userid }).limit(1).get().catch(() => ({ data: [] }))
  const acct = (hit && hit.data && hit.data[0]) || null
  if (!acct) return reply(403, { ok: false, error: 'NO_BOUND_ACCOUNT' }) // userid 未绑任何坐席账号·fail-closed 拒登
  if (acct.disabled) return reply(403, { ok: false, error: 'ACCOUNT_DISABLED' })
  // 签发高熵 session 令牌（存 sha·checkKey.resolveWecomSession 认；一账号一令牌·新登失效旧设备）
  const sessionToken = randomBytes(32).toString('hex')
  await db
    .collection('adminConfig')
    .doc(acct._id)
    .update({ data: { wecomSessionHash: sha(sessionToken), wecomSessionExp: Date.now() + SESSION_TTL_MS, updatedAt: Date.now() } })
  const isSuper = acct._id === 'auth'
  return reply(200, {
    ok: true,
    sessionToken,
    operator: acct.name || (isSuper ? 'admin' : acct._id),
    agentId: isSuper ? 'admin' : acct._id,
    caps: acct.role ? capsForRole(acct.role) : Array.isArray(acct.caps) ? acct.caps : isSuper ? ['*'] : [],
  })
}

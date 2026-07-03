import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import cloud, { control } from 'wx-server-sdk'
import { createHash } from 'node:crypto'
import { loginByWecomCode } from '../../packages/cloud/src/functions/admin/adminApi/actions/wecomLogin'
import { checkKey } from '../../packages/cloud/src/functions/admin/adminApi/lib'

// M⑦ 车道 B·企微 OAuth 免登（承面C 增强）：code→userid→查绑定账号→签发 session 令牌（issueSession 单源·
// 口令登录同款·深审 P1）；checkKey 认令牌（口令全未命中→会话解析 fallback）。守卫 wecom-login-gated 的行为侧锁（fail-closed·根因#3）。
const db = cloud.database()
const ctx = (data) => ({ db, data })
const parse = (res) => JSON.parse(res.body)
const sha = (s) => createHash('sha256').update(String(s)).digest('hex')

const seedToken = () => control.seed('kfState', [{ _id: 'token', accessToken: 'TKN', expireAt: Date.now() + 3600_000 }])
// 超管 auth doc（生产环境永远有商户超管·checkKey 无 auth 会走 bootstrap 早返·真实部署不会）
const seedSuper = () => control.seed('adminConfig', [{ _id: 'auth', role: 'superadmin', keyHash: sha('boss-pw') }])
// 绑定账号：外包 agent（role=outsourced）——与超管共存（真实态）
const seedAgent = (wecomUserId, extra = {}) => {
  seedSuper()
  control.seed('adminConfig', [{ _id: 'agent:1', name: '客服-小李', role: 'outsourced', keyHash: sha('pw-secret'), disabled: false, wecomUserId, ...extra }])
}

let savedFetch
function stubOAuth(userid) {
  globalThis.fetch = async (url) => ({
    json: async () => (String(url).includes('auth/getuserinfo') ? (userid ? { userid } : { errcode: 40029 }) : {}),
  })
}
beforeEach(() => {
  control.reset()
  savedFetch = globalThis.fetch
})
afterEach(() => {
  globalThis.fetch = savedFetch
})

describe('loginByWecomCode 免登签发（fail-closed）', () => {
  it('有效 code→绑定账号 → 签发 sessionToken + caps/operator·令牌入库(sha)', async () => {
    seedToken()
    seedAgent('LiSi')
    stubOAuth('LiSi')
    const r = parse(await loginByWecomCode(ctx({ code: 'CODE-1' })))
    expect(r.ok).toBe(true)
    expect(r.sessionToken).toMatch(/^[0-9a-f]{64}$/) // 高熵 32 字节 hex
    expect(r.caps).toEqual(['agent:handle'])
    expect(r.operator).toBe('客服-小李')
    expect(r.agentId).toBe('agent:1')
    const doc = control.dump('adminConfig').find((a) => a._id === 'agent:1')
    // 存 sessions 数组（口令登录同款单源 issueSession·深审 P1）：sha 入库·不存明文
    expect(doc.sessions).toHaveLength(1)
    expect(doc.sessions[0].hash).toBe(sha(r.sessionToken))
    expect(doc.sessions[0].exp).toBeGreaterThan(Date.now())
    expect(doc.sessions[0].via).toBe('wecom')
  })

  it('签发的令牌可经 checkKey 认（后续请求鉴权·免口令）', async () => {
    seedToken()
    seedAgent('LiSi')
    stubOAuth('LiSi')
    const token = parse(await loginByWecomCode(ctx({ code: 'CODE-1' }))).sessionToken
    const auth = await checkKey(db, token, false)
    expect(auth.ok).toBe(true)
    expect(auth.agentId).toBe('agent:1')
    expect(auth.caps).toEqual(['agent:handle'])
  })

  it('超管 auth 绑 userid → 免登 agentId=admin·caps=[*]', async () => {
    seedToken()
    control.seed('adminConfig', [{ _id: 'auth', role: 'superadmin', keyHash: sha('boss-pw'), wecomUserId: 'Boss' }])
    stubOAuth('Boss')
    const r = parse(await loginByWecomCode(ctx({ code: 'CODE-B' })))
    expect(r.ok).toBe(true)
    expect(r.agentId).toBe('admin')
    expect(r.caps).toEqual(['*'])
    const auth = await checkKey(db, r.sessionToken, false)
    expect(auth.agentId).toBe('admin')
  })

  it('fail-closed：无 code BAD_ARGS / 无缓存令牌 KF_TOKEN_UNAVAILABLE / OAuth 无 userid BAD_CODE', async () => {
    seedAgent('LiSi')
    stubOAuth('LiSi')
    expect(parse(await loginByWecomCode(ctx({}))).error).toBe('BAD_ARGS') // 无 code（且不触外部调用）
    expect(parse(await loginByWecomCode(ctx({ code: 'C' }))).error).toBe('KF_TOKEN_UNAVAILABLE') // 无缓存令牌
    seedToken()
    stubOAuth('') // OAuth errcode
    expect(parse(await loginByWecomCode(ctx({ code: 'C' }))).error).toBe('BAD_CODE')
  })

  it('fail-closed：userid 未绑账号 NO_BOUND_ACCOUNT / 账号停用 ACCOUNT_DISABLED（不签发令牌）', async () => {
    seedToken()
    stubOAuth('Ghost')
    expect(parse(await loginByWecomCode(ctx({ code: 'C' }))).error).toBe('NO_BOUND_ACCOUNT') // 无匹配 wecomUserId
    seedAgent('LiSi', { disabled: true })
    stubOAuth('LiSi')
    const r = parse(await loginByWecomCode(ctx({ code: 'C' })))
    expect(r.error).toBe('ACCOUNT_DISABLED')
    expect(control.dump('adminConfig').find((a) => a._id === 'agent:1').sessions).toBeUndefined() // 拒登不签发
  })
})

describe('checkKey 免登令牌分支 fail-closed', () => {
  it('过期令牌 → SESSION_EXPIRED（不放行）', async () => {
    seedToken()
    seedAgent('LiSi')
    stubOAuth('LiSi')
    const token = parse(await loginByWecomCode(ctx({ code: 'C' }))).sessionToken
    // 手动把过期戳改到过去（sessions 数组内该条目的 exp）
    const stale = [{ hash: sha(token), exp: Date.now() - 1000, via: 'wecom', at: Date.now() }]
    await db.collection('adminConfig').doc('agent:1').update({ data: { sessions: stale } })
    expect((await checkKey(db, token, false)).error).toBe('SESSION_EXPIRED')
  })

  it('账号登录后被停用 → 令牌即失效 ACCOUNT_DISABLED', async () => {
    seedToken()
    seedAgent('LiSi')
    stubOAuth('LiSi')
    const token = parse(await loginByWecomCode(ctx({ code: 'C' }))).sessionToken
    await db.collection('adminConfig').doc('agent:1').update({ data: { disabled: true } })
    expect((await checkKey(db, token, false)).error).toBe('ACCOUNT_DISABLED')
  })

  it('乱造令牌 → BAD_KEY（撞不上任何会话 hash）', async () => {
    seedAgent('LiSi')
    expect((await checkKey(db, 'a'.repeat(64), false)).error).toBe('BAD_KEY')
  })
})

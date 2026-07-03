import { describe, it, expect, beforeEach } from 'vitest'
import { createHash } from 'node:crypto'
import cloud, { control } from 'wx-server-sdk'
import { main } from '../../packages/cloud/src/functions/admin/adminApi'

// 口令登录签发会话令牌（深审 P1·根因#3 口令不落盘）：login 成功必返 sessionToken（sha 入账号 sessions 数组·
// 绝不存明文）；令牌可作后续请求 key（checkKey 会话解析）；过期/停号 fail-closed 拒；多设备并存（sessions
// 数组·超容剪最旧）；口令作 key 兼容不破（旧已部署前端）。守卫 admin-session-issued 的行为侧。
const sha = (s) => createHash('sha256').update(String(s)).digest('hex')
const SUPER = 'super-admin-key-123'
const OUT = 'outsourced-key-123'
const db = cloud.database()
const call = (action, key, data = {}) =>
  main({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ action, key, data }) }).then((r) => ({
    status: r.statusCode,
    ...JSON.parse(r.body),
  }))

beforeEach(() => {
  control.reset()
  control.seed('adminConfig', [
    { _id: 'auth', keyHash: sha(SUPER), role: 'superadmin', caps: ['*'], name: '老板' },
    { _id: 'agent:out1', keyHash: sha(OUT), role: 'outsourced', name: '客服-小李' },
  ])
})

describe('口令登录签发会话令牌（深审 P1·#3 口令不落盘）', () => {
  it('登录成功 → 返 sessionToken（高熵 hex64）+ caps/operator；sha 入 sessions 数组、明文不落库', async () => {
    const r = await call('login', SUPER)
    expect(r.status).toBe(200)
    expect(r.ok).toBe(true)
    expect(r.sessionToken).toMatch(/^[0-9a-f]{64}$/)
    expect(r.caps).toEqual(['*'])
    expect(r.operator).toBe('老板')
    const doc = control.dump('adminConfig').find((a) => a._id === 'auth')
    expect(doc.sessions).toHaveLength(1)
    expect(doc.sessions[0].hash).toBe(sha(r.sessionToken))
    expect(doc.sessions[0].exp).toBeGreaterThan(Date.now())
    expect(doc.sessions[0].via).toBe('pwd')
    expect(JSON.stringify(doc)).not.toContain(r.sessionToken) // 令牌明文绝不入库
  })

  it('令牌可作后续请求 key：外包令牌解析出 agent:handle（过能力闸）、身份归本账号', async () => {
    const login = await call('login', OUT)
    expect(login.status).toBe(200)
    const r = await call('listQueue', login.sessionToken)
    expect(r.status).toBe(200)
    expect(r.ok).toBe(true)
    // 令牌解析的身份仍受 RBAC：外包令牌调超管 action 一样 403（令牌≠提权）
    const deny = await call('saveSettings', login.sessionToken, {})
    expect(deny.status).toBe(403)
  })

  it('过期令牌 → 401 SESSION_EXPIRED（fail-closed·不放行）', async () => {
    const token = (await call('login', SUPER)).sessionToken
    await db
      .collection('adminConfig')
      .doc('auth')
      .update({ data: { sessions: [{ hash: sha(token), exp: Date.now() - 1000, via: 'pwd', at: Date.now() }] } })
    const r = await call('listDrafts', token)
    expect(r.status).toBe(401)
    expect(r.error).toBe('SESSION_EXPIRED')
  })

  it('停号后令牌立即失效 → 401 ACCOUNT_DISABLED（不等过期）', async () => {
    const token = (await call('login', OUT)).sessionToken
    await db.collection('adminConfig').doc('agent:out1').update({ data: { disabled: true } })
    const r = await call('listQueue', token)
    expect(r.status).toBe(401)
    expect(r.error).toBe('ACCOUNT_DISABLED')
  })

  it('多设备并存：两次登录两令牌都有效（商户控制台+坐席台不互踢）', async () => {
    const t1 = (await call('login', SUPER)).sessionToken
    const t2 = (await call('login', SUPER)).sessionToken
    expect(t1).not.toBe(t2)
    expect((await call('listDrafts', t1)).status).toBe(200)
    expect((await call('listDrafts', t2)).status).toBe(200)
    expect(control.dump('adminConfig').find((a) => a._id === 'auth').sessions).toHaveLength(2)
  })

  it('超容剪最旧：连续 9 次登录只留 8 个会话、最早令牌失效（sessions 不无界膨胀）', async () => {
    const tokens = []
    for (let i = 0; i < 9; i++) tokens.push((await call('login', SUPER)).sessionToken)
    expect(control.dump('adminConfig').find((a) => a._id === 'auth').sessions).toHaveLength(8)
    expect((await call('listDrafts', tokens[0])).status).toBe(401) // 最早的被剪
    expect((await call('listDrafts', tokens[8])).status).toBe(200) // 最新的有效
  })

  it('口令作 key 兼容不破（旧已部署前端仍能用）：直接以口令调受权 action 照常过', async () => {
    const r = await call('listDrafts', SUPER)
    expect(r.status).toBe(200)
    expect(r.ok).toBe(true)
  })
})

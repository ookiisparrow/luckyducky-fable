// adminApi 会话令牌：令牌不能换令牌、登出服务端吊销、停号清会话、全局爆破推企微、会话请求不跑 scrypt。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import crypto from 'crypto'
import { control } from 'wx-server-sdk'
import { main as adminApi } from '../src/functions/adminApi/index'
import { sha, kdf, issueSession } from '../src/functions/adminApi/lib'
import { getDb } from '../src/kit'

const SUPER = 'super-secret-key'
const A1 = 'outsourced-key-1'

const post = (action: string, key: string, data: Record<string, unknown> = {}, ip = '1.1.1.1') =>
  adminApi({
    httpMethod: 'POST',
    headers: { 'x-forwarded-for': ip },
    body: JSON.stringify({ action, key, data }),
  }).then((r: any) => ({ status: r.statusCode, ...JSON.parse(r.body) }))

const acct = (id: string) => control.dump('adminConfig').find((d: any) => d._id === id)

beforeEach(() => {
  control.reset()
  control.setOpenId('')
  control.seed('adminConfig', [
    { _id: 'auth', keyHash: sha(SUPER), role: 'superadmin' },
    { _id: 'agent-1', keyHash: sha(A1), role: 'outsourced', name: '外包一号' },
  ])
})
afterEach(() => vi.restoreAllMocks())

describe('会话令牌不能再换令牌', () => {
  it('大白话：拿偷到的令牌去调 login，被当错口令拒掉，也不多签一枚', async () => {
    const token = (await post('login', SUPER)).sessionToken
    expect(token).toHaveLength(64)
    const r = await post('login', token)
    expect(r).toMatchObject({ status: 401, ok: false, error: 'BAD_KEY' })
    expect(r.sessionToken).toBeUndefined()
    expect(acct('auth').sessions).toHaveLength(1)
  })
})

describe('登出在服务端吊销当前令牌', () => {
  it('大白话：登出后这枚令牌立刻失效，同账号另一台设备的令牌不受影响', async () => {
    const t1 = (await post('login', SUPER)).sessionToken
    const t2 = (await post('login', SUPER)).sessionToken
    expect(await post('logout', t1)).toMatchObject({ status: 200, ok: true })
    expect(await post('getSettings', t1)).toMatchObject({ status: 401, error: 'BAD_KEY' })
    expect((await post('getSettings', t2)).ok).toBe(true)
    expect(acct('auth').sessions.map((s: any) => s.hash)).toEqual([sha(t2)])
  })

  it('大白话：外包坐席没有 admin:write 也能登出，不被能力闸 403', async () => {
    const t = (await post('login', A1)).sessionToken
    expect(await post('logout', t)).toMatchObject({ status: 200, ok: true })
    expect(await post('listQueue', t)).toMatchObject({ status: 401 })
  })

  it('大白话：拿一枚本就无效的令牌登出，照样回成功、不动任何账号', async () => {
    await post('login', SUPER)
    const before = JSON.stringify(acct('auth').sessions)
    expect(await post('logout', 'f'.repeat(64))).toMatchObject({ status: 200, ok: true })
    expect(JSON.stringify(acct('auth').sessions)).toBe(before)
  })

  it('大白话：会话扫描读失败时登出回 503，不谎报已吊销', async () => {
    const t = (await post('login', SUPER)).sessionToken
    control.setBeforeGet((a: any) => {
      if (a.coll === 'adminConfig' && a.filter && 'sessions' in a.filter) throw new Error('NETWORK_TIMEOUT')
    })
    try {
      expect(await post('logout', t)).toMatchObject({ status: 503, ok: false, error: 'AUTH_UNAVAILABLE' })
    } finally {
      control.setBeforeGet(null as never)
    }
    expect((await post('getSettings', t)).ok).toBe(true)
  })
})

describe('停用外包账号清空其全部会话', () => {
  it('大白话：停号后旧令牌失效；再启用，旧令牌也不复活，必须重新登录', async () => {
    const t = (await post('login', A1)).sessionToken
    expect((await post('listQueue', t)).ok).toBe(true)
    expect((await post('disableAgent', SUPER, { id: 'agent-1', disabled: true })).ok).toBe(true)
    expect(acct('agent-1').sessions).toEqual([])
    expect((await post('listQueue', t)).status).toBe(401)
    expect((await post('disableAgent', SUPER, { id: 'agent-1', disabled: false })).ok).toBe(true)
    expect(await post('listQueue', t)).toMatchObject({ status: 401, error: 'BAD_KEY' })
    expect((await post('listQueue', (await post('login', A1)).sessionToken)).ok).toBe(true)
  })
})

describe('全局爆破到阈：进 anomalies 并推企微，一轮锁定只推一次', () => {
  it('大白话：轮换 IP 打到第 20 次错口令时推一条企微、记一条异常；锁定期内继续打不再逐条推', async () => {
    control.seed('adminConfig', [{ _id: 'settings', alertWebhook: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=k1' }])
    const pushed: string[] = []
    vi.stubGlobal('fetch', async (url: any, init: any) => {
      pushed.push(String(init && init.body))
      return { status: 200, json: async () => ({ errcode: 0 }) }
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    for (let i = 0; i < 19; i++) await post('login', 'wrong-long-key', {}, `30.0.0.${i}`)
    expect(pushed).toHaveLength(0)
    await post('login', 'wrong-long-key', {}, '30.0.0.19')
    expect(pushed).toHaveLength(1)
    expect(pushed[0]).toContain('GLOBAL_BRUTE')
    expect(control.dump('anomalies').filter((a: any) => a.code === 'GLOBAL_BRUTE')).toHaveLength(1)
    for (let i = 0; i < 5; i++) await post('someAction', 'wrong-long-key', {}, `31.0.0.${i}`)
    expect(pushed).toHaveLength(1)
    vi.unstubAllGlobals()
  })

  it('大白话：上锁那一刻正有几十个错口令请求并发在跑，也只推一条企微', async () => {
    control.seed('adminConfig', [{ _id: 'settings', alertWebhook: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=k1' }])
    const pushed: string[] = []
    vi.stubGlobal('fetch', async (url: any, init: any) => {
      pushed.push(String(init && init.body))
      return { status: 200, json: async () => ({ errcode: 0 }) }
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    for (let i = 0; i < 15; i++) await post('login', 'wrong-long-key', {}, `32.0.0.${i}`)
    await Promise.all(Array.from({ length: 30 }, (_, i) => post('login', 'wrong-long-key', {}, `33.0.0.${i}`)))
    expect(pushed.filter((b) => b.includes('GLOBAL_BRUTE'))).toHaveLength(1)
    vi.unstubAllGlobals()
  })
})

describe('会话写入不复活已停号账号的令牌', () => {
  it('大白话：登录签令牌读完旧会话、还没写回时超管把号停了——写回被拒，再启用旧令牌也不复活', async () => {
    const tOld = (await post('login', A1)).sessionToken
    let injected = false
    control.setBeforeUpdate(async (a: any) => {
      if (injected || a.coll !== 'adminConfig' || !Array.isArray(a.data.sessions) || !a.data.sessions.length) return
      injected = true
      expect((await post('disableAgent', SUPER, { id: 'agent-1', disabled: true })).ok).toBe(true)
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const r = await post('login', A1)
      expect(injected).toBe(true)
      expect(r.sessionToken).toBe('')
    } finally {
      control.setBeforeUpdate(null as never)
    }
    expect(acct('agent-1').sessions).toEqual([])
    expect((await post('disableAgent', SUPER, { id: 'agent-1', disabled: false })).ok).toBe(true)
    expect(await post('listQueue', tOld)).toMatchObject({ status: 401, error: 'BAD_KEY' })
  })

  it('大白话：直接给已停用账号签令牌，一律拒写，不留一枚能在启用后复活的令牌', async () => {
    expect((await post('disableAgent', SUPER, { id: 'agent-1', disabled: true })).ok).toBe(true)
    await expect(issueSession(getDb(), 'agent-1', 'wecom')).rejects.toThrow('SESSION_WRITE_FAIL')
    expect(acct('agent-1').sessions).toEqual([])
  })
})

describe('adminConfig 集合还没建（首登前）', () => {
  it('大白话：带随机令牌调业务回 401 BAD_KEY、登出回 200，不当库故障回 503', async () => {
    control.reset()
    control.setBeforeGet(({ coll }: any) => {
      if (coll === 'adminConfig') throw new Error('DATABASE_COLLECTION_NOT_EXIST:adminConfig')
    })
    try {
      expect(await post('getSettings', 'a'.repeat(64))).toMatchObject({ status: 401, error: 'BAD_KEY' })
      expect(await post('logout', 'a'.repeat(64))).toMatchObject({ status: 200, ok: true })
    } finally {
      control.setBeforeGet(null as never)
    }
  })
})

describe('改绑/解绑企微 userid 吊销该账号的企微免登会话', () => {
  // 走真实免登链路：缓存令牌 + 企微 getuserinfo 换 userid（fetch 桩按当前扮演的企微成员回包）
  let wecomUser = ''
  const wecomLogin = async (userid: string, ip: string) => {
    wecomUser = userid
    return (await post('loginByWecomCode', '', { code: 'c' }, ip)).sessionToken as string
  }
  beforeEach(() => {
    control.seed('kfState', [{ _id: 'token', accessToken: 'TKN', expireAt: Date.now() + 3600_000 }])
    vi.stubGlobal('fetch', async (url: any) => ({
      json: async () => (String(url).includes('auth/getuserinfo') ? { errcode: 0, userid: wecomUser } : { errcode: 0 }),
    }))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('大白话：外包号从 Alice 改绑到 Bob，Alice 之前免登拿的令牌立刻 401；Bob 能免登，同账号口令会话不受影响', async () => {
    expect((await post('setAgentWecomUserId', SUPER, { id: 'agent-1', wecomUserId: 'alice' })).ok).toBe(true)
    const tAlice = await wecomLogin('alice', '50.0.0.1')
    const tPwd = (await post('login', A1)).sessionToken
    expect((await post('listQueue', tAlice)).ok).toBe(true)
    expect((await post('setAgentWecomUserId', SUPER, { id: 'agent-1', wecomUserId: 'bob' })).ok).toBe(true)
    expect(await post('listQueue', tAlice)).toMatchObject({ status: 401, error: 'SESSION_EXPIRED' })
    expect((await post('listQueue', await wecomLogin('bob', '50.0.0.2'))).ok).toBe(true)
    expect((await post('listQueue', tPwd)).ok).toBe(true)
  })

  it('大白话：超管给自己解绑企微，企微会话失效，自己当前的口令会话还在', async () => {
    expect((await post('setAgentWecomUserId', SUPER, { id: 'auth', wecomUserId: 'boss' })).ok).toBe(true)
    const tWecom = await wecomLogin('boss', '50.0.0.3')
    const tPwd = (await post('login', SUPER)).sessionToken
    expect((await post('setAgentWecomUserId', tPwd, { id: 'auth', wecomUserId: '' })).ok).toBe(true)
    expect(await post('getSettings', tWecom)).toMatchObject({ status: 401, error: 'SESSION_EXPIRED' })
    expect((await post('getSettings', tPwd)).ok).toBe(true)
  })

  it('大白话：绑定没变（同值重存）企微令牌照常可用', async () => {
    expect((await post('setAgentWecomUserId', SUPER, { id: 'agent-1', wecomUserId: 'alice' })).ok).toBe(true)
    const t = await wecomLogin('alice', '50.0.0.4')
    expect((await post('setAgentWecomUserId', SUPER, { id: 'agent-1', wecomUserId: 'alice' })).ok).toBe(true)
    expect((await post('listQueue', t)).ok).toBe(true)
  })
})

describe('会话请求不再逐账号跑 scrypt', () => {
  it('大白话：3 个带盐坐席账号时，带令牌的业务请求 scrypt 0 次（原来 1+3 次）；口令登录仍逐账号比对', async () => {
    const seeded = ['a', 'b', 'c'].map((n) => ({ _id: 'agent-' + n, keySalt: 's' + n, keyHash: kdf('agent-key-' + n, 's' + n), role: 'outsourced' }))
    control.reset()
    control.seed('adminConfig', [{ _id: 'auth', keySalt: 's0', keyHash: kdf(SUPER, 's0'), role: 'superadmin' }, ...seeded])
    const superT = (await post('login', SUPER)).sessionToken
    const agentT = (await post('login', 'agent-key-c')).sessionToken
    const scrypt = vi.spyOn(crypto, 'scryptSync')
    expect((await post('getSettings', superT)).ok).toBe(true)
    expect((await post('listQueue', agentT)).ok).toBe(true)
    expect(scrypt).toHaveBeenCalledTimes(0)
    expect((await post('login', 'random-guess-1', {}, '40.0.0.1')).status).toBe(401)
    expect(scrypt).toHaveBeenCalledTimes(4)
  })
})

// adminApi 认证与配置件：库读失败 ≠ 查无此号 / 空档 / 未配置（根因#14）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as adminApi } from '../src/functions/adminApi/index'
import { sha, issueSession, activationFor } from '../src/functions/adminApi/lib'
import { getDb } from '../src/kit'

const SUPER = 'super-secret-key'
const A1 = 'outsourced-key-1'

const post = (action: string, key: string, data: Record<string, unknown> = {}, ip = '1.1.1.1') =>
  adminApi({
    httpMethod: 'POST',
    headers: { 'x-forwarded-for': ip },
    body: JSON.stringify({ action, key, data }),
  }).then((r: any) => ({ status: r.statusCode, ...JSON.parse(r.body) }))

const failDoc = (coll: string, id: string) =>
  control.setBeforeGet((a: any) => {
    if (a.coll === coll && a.id === id) throw new Error('NETWORK_TIMEOUT')
  })
const failScan = (field: string) =>
  control.setBeforeGet((a: any) => {
    if (a.coll === 'adminConfig' && a.filter && field in a.filter) throw new Error('NETWORK_TIMEOUT')
  })
const docOf = (coll: string, id: string) => control.dump(coll).find((d: any) => d._id === id)
const alertLines = (spy: { mock: { calls: unknown[][] } }, code: string) =>
  spy.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('[LD_ALERT]') && l.includes(`code=${code}`))

beforeEach(() => {
  control.reset()
  control.setOpenId('')
  control.seed('adminConfig', [
    { _id: 'auth', keyHash: sha(SUPER), role: 'superadmin' },
    { _id: 'agent-1', keyHash: sha(A1), role: 'outsourced', name: '外包一号', wecomUserId: 'w1' },
  ])
})
afterEach(() => {
  control.setBeforeGet(null as never)
  vi.restoreAllMocks()
})

describe('口令/令牌校验：库挂了回 503，不当错口令踢人、不记爆破', () => {
  it('大白话：超管档读失败——登录和业务请求都回 503 AUTH_UNAVAILABLE；连挂 6 次不锁 IP，库好了照常登', async () => {
    failDoc('adminConfig', 'auth')
    for (let i = 0; i < 6; i++) {
      expect(await post('login', SUPER, {}, '7.7.7.7')).toMatchObject({ status: 503, ok: false, error: 'AUTH_UNAVAILABLE' })
    }
    expect(await post('getSettings', SUPER, {}, '7.7.7.7')).toMatchObject({ status: 503, error: 'AUTH_UNAVAILABLE' })
    control.setBeforeGet(null as never)
    expect((await post('login', SUPER, {}, '7.7.7.7')).status).toBe(200)
  })

  it('大白话：业务请求撞超管档读失败——连挂 6 次都回 503、不写频控计数，库好了同 IP 照常用（不回 429）', async () => {
    failDoc('adminConfig', 'auth')
    for (let i = 0; i < 6; i++) {
      expect(await post('getSettings', SUPER, {}, '8.8.8.8')).toMatchObject({ status: 503, error: 'AUTH_UNAVAILABLE' })
    }
    expect(control.dump('rateLimit').filter((r: any) => /^rl_adminlogin:/.test(r._id))).toEqual([])
    control.setBeforeGet(null as never)
    expect(await post('getSettings', SUPER, {}, '8.8.8.8')).toMatchObject({ status: 200, ok: true })
  })

  it('大白话：多账号口令扫描读失败——外包口令回 503，不当查无此号', async () => {
    failScan('keyHash')
    expect(await post('listQueue', A1)).toMatchObject({ status: 503, error: 'AUTH_UNAVAILABLE' })
  })

  it('大白话：会话令牌扫描读失败——手里的令牌回 503（前端不清令牌），不回 401 把人踢下线', async () => {
    const token = (await post('login', SUPER)).sessionToken
    expect(token).toBeTruthy()
    failScan('sessions')
    expect(await post('getSettings', token)).toMatchObject({ status: 503, error: 'AUTH_UNAVAILABLE' })
    control.setBeforeGet(null as never)
    expect((await post('getSettings', token)).ok).toBe(true)
  })

  it('大白话：真没有超管档（空库）仍按首登引导走，不因改动变成 503', async () => {
    control.reset()
    expect(await post('login', 'anything-long')).toMatchObject({ status: 401, error: 'BAD_KEY' })
  })
})

describe('签发令牌：读账号档失败不拿空基线覆盖 sessions', () => {
  const twoSessions = () => {
    const exp = Date.now() + 3600_000
    control.reset()
    control.seed('adminConfig', [
      { _id: 'auth', keyHash: sha(SUPER), role: 'superadmin', sessions: [{ hash: 'h1', exp }, { hash: 'h2', exp }] },
    ])
  }

  it('大白话：读失败直接抛，别的设备的两个会话原封不动', async () => {
    twoSessions()
    failDoc('adminConfig', 'auth')
    await expect(issueSession(getDb(), 'auth', 'pwd')).rejects.toThrow()
    expect(docOf('adminConfig', 'auth').sessions.map((s: any) => s.hash)).toEqual(['h1', 'h2'])
  })

  it('大白话：口令登录时签发读失败——不发令牌（前端按 NO_SESSION_TOKEN 拒登），旧会话还在', async () => {
    twoSessions()
    let n = 0
    control.setBeforeGet((a: any) => {
      if (a.coll === 'adminConfig' && a.id === 'auth' && ++n === 2) throw new Error('NETWORK_TIMEOUT') // 第 1 次是 checkKey，第 2 次是 issueSession
    })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await post('login', SUPER)
    expect(r.sessionToken).toBe('')
    expect(alertLines(spy, 'SESSION_ISSUE_FAIL')[0]).toContain('"via":"pwd"')
    expect(docOf('adminConfig', 'auth').sessions.map((s: any) => s.hash)).toEqual(['h1', 'h2'])
  })

  it('大白话：企微免登签发读失败——不发令牌、不抛裸异常，旧会话还在', async () => {
    const exp = Date.now() + 3600_000
    control.reset()
    control.seed('adminConfig', [
      { _id: 'agent-1', keyHash: sha(A1), role: 'outsourced', wecomUserId: 'w1', sessions: [{ hash: 'h1', exp }] },
    ])
    control.seed('kfState', [{ _id: 'token', accessToken: 'TKN', expireAt: Date.now() + 3600_000 }])
    const saved = globalThis.fetch
    ;(globalThis as any).fetch = async (url: any) => ({
      json: async () => (String(url).includes('auth/getuserinfo') ? { errcode: 0, userid: 'w1' } : { errcode: 0 }),
    })
    try {
      failDoc('adminConfig', 'agent-1')
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const r = await post('loginByWecomCode', '', { code: 'c' })
      expect(r.sessionToken || '').toBe('')
      expect(alertLines(spy, 'SESSION_ISSUE_FAIL')[0]).toContain('"via":"wecom"')
      expect(docOf('adminConfig', 'agent-1').sessions.map((s: any) => s.hash)).toEqual(['h1'])
    } finally {
      globalThis.fetch = saved
    }
  })
})

describe('激活态：商品读失败不回退默认课程去查错课', () => {
  it('大白话：商品绑了自定义课程且已进课——读商品失败就抛，不报成「未激活」', async () => {
    control.seed('products', [{ _id: 'p1', courseId: 'custom-c' }])
    control.seed('activations', [{ _id: 'a1', _openid: 'o1', courseId: 'custom-c', enteredAt: 5 }])
    expect((await activationFor(getDb(), 'o1', 'p1')).entered).toBe(true)
    failDoc('products', 'p1')
    await expect(activationFor(getDb(), 'o1', 'p1')).rejects.toThrow()
  })

  it('大白话：商品真删了仍回退 course-<pid>', async () => {
    control.seed('activations', [{ _id: 'a1', _openid: 'o1', courseId: 'course-p9' }])
    expect(await activationFor(getDb(), 'o1', 'p9')).toMatchObject({ courseId: 'course-p9', activated: true })
  })
})

describe('配置写入：读失败停写，不拿 {} 整档覆盖', () => {
  it('大白话：只改商户号时读 config/pay 超时——回 DOC_READ_FAIL，mode/flowId 一个不丢', async () => {
    control.seed('config', [{ _id: 'pay', mode: 'real', flowId: 'F1', refundFlowId: 'R1' }])
    failDoc('config', 'pay')
    expect(await post('savePayConfig', SUPER, { subMchId: '123' })).toMatchObject({ ok: false, error: 'DOC_READ_FAIL' })
    expect(docOf('config', 'pay')).toMatchObject({ mode: 'real', flowId: 'F1', refundFlowId: 'R1' })
    expect(docOf('config', 'pay').subMchId).toBeUndefined()
  })

  it('大白话：只改证书序列号时读 wxpay 超时——私钥不被抹掉', async () => {
    control.seed('secureConfig', [{ _id: 'wxpay', mchPrivateKey: 'KEEP-KEY', mchSerial: 'OLD' }])
    failDoc('secureConfig', 'wxpay')
    expect(await post('saveSecureConfig', SUPER, { docId: 'wxpay', fields: { mchSerial: 'NEW' } })).toMatchObject({
      ok: false,
      error: 'DOC_READ_FAIL',
    })
    expect(docOf('secureConfig', 'wxpay')).toMatchObject({ mchPrivateKey: 'KEEP-KEY', mchSerial: 'OLD' })
  })

  it('大白话：真没有档（集合未建）照常首存', async () => {
    control.setBeforeGet((a: any) => {
      if (a.coll === 'config' && a.id === 'pay') throw new Error('DATABASE_COLLECTION_NOT_EXIST:config')
    })
    expect((await post('savePayConfig', SUPER, { mode: 'real' })).ok).toBe(true)
    expect(docOf('config', 'pay').mode).toBe('real')
  })
})

describe('配置清单：读失败不显示成「未配置」', () => {
  it('大白话：secureConfig/wxkf 读失败——整页回 DOC_READ_FAIL，不诱导重填密钥', async () => {
    control.seed('secureConfig', [{ _id: 'wxkf', agentId: '1000002' }])
    failDoc('secureConfig', 'wxkf')
    expect(await post('getConfigChecklist', SUPER)).toMatchObject({ ok: false, error: 'DOC_READ_FAIL' })
  })

  it('大白话：集合还没建——照常出清单、按未配置显示', async () => {
    control.setBeforeGet((a: any) => {
      if (a.coll === 'secureConfig') throw new Error('DATABASE_COLLECTION_NOT_EXIST:secureConfig')
    })
    const r = await post('getConfigChecklist', SUPER)
    expect(r.ok).toBe(true)
    const item = r.groups.flatMap((g: any) => g.items).find((i: any) => i.key === 'WXKF_AGENTID')
    expect(item.status).toBe('missing')
  })
})

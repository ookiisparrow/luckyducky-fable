// 黄金 cs-agent §二/§三/§八/§九/§十一（守卫 rw-cs1-golden）。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import crypto from 'node:crypto'
import { control } from 'wx-server-sdk'
import { main as app } from '../src/functions/app/index'
import { main as kfSend } from '../src/functions/cs/kfSend'
import { main as kfMedia } from '../src/functions/cs/kfMedia'
import { main as kfHealthProbe } from '../src/functions/timers/kfHealthProbe'
import { main as recallScan } from '../src/functions/timers/recallScan'
import { recallCandidates } from '../src/functions/timers/recallRules'
import {
  kfSignature,
  verifyKfSignature,
  decryptKfMessage,
  defineKfCallback,
  ensureSmartAssistant,
  getAccessToken,
  getKfMedia,
  assertDataShareConsent,
  assertOwnedByAgent,
} from '../src/kit'

const call = (action: string, data: Record<string, unknown> = {}) => app({ action, data }) as Promise<any>

// WXBizMsgCrypt 正向加密（测试构造密文·与 decryptKfMessage 互为逆运算）
const AES_KEY = 'a'.repeat(43)
function encryptKf(encodingAESKey: string, message: string, receiveId: string): string {
  const key = Buffer.from(encodingAESKey + '=', 'base64')
  const iv = key.subarray(0, 16)
  const msg = Buffer.from(message, 'utf8')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(msg.length, 0)
  let buf = Buffer.concat([crypto.randomBytes(16), len, msg, Buffer.from(receiveId, 'utf8')])
  const pad = 32 - (buf.length % 32 || 32) || 32
  buf = Buffer.concat([buf, Buffer.alloc(pad, pad)])
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv)
  cipher.setAutoPadding(false)
  return Buffer.concat([cipher.update(buf), cipher.final()]).toString('base64')
}

const ENV_KEYS = ['WXKF_CORPID', 'WXKF_SECRET'] as const
let fetchBackup: any

beforeEach(() => {
  control.reset()
  control.setOpenId('oME')
  fetchBackup = (globalThis as any).fetch
})
afterEach(() => {
  ;(globalThis as any).fetch = fetchBackup
  for (const k of ENV_KEYS) delete process.env[k]
})

const stubFetch = (router: (url: string, body?: any) => any) => {
  ;(globalThis as any).fetch = async (url: string, init?: any) => ({
    json: async () => router(String(url), init?.body ? JSON.parse(init.body) : undefined),
  })
}

describe('验签与解密（黄金 §十一·全场最关键）', () => {
  it('大白话：正确签名验证通过；篡改任一要素即拒（常量时间比较）', () => {
    const sig = kfSignature('tok', '111', '222', 'ENC')
    expect(verifyKfSignature('tok', '111', '222', 'ENC', sig)).toBe(true)
    expect(verifyKfSignature('tok', '111', '222', 'ENC', sig.slice(0, -1) + 'x')).toBe(false)
    expect(verifyKfSignature('tok', '111', '999', 'ENC', sig)).toBe(false)
  })

  it('大白话：解密是加密的真逆运算（取回原文与接收方 id）；声明长度越界抛错不返回错位切片', () => {
    const enc = encryptKf(AES_KEY, '<xml><Token>t1</Token></xml>', 'corp-1')
    const dec = decryptKfMessage(AES_KEY, enc)
    expect(dec.message).toBe('<xml><Token>t1</Token></xml>')
    expect(dec.receiveId).toBe('corp-1')
    expect(() => decryptKfMessage(AES_KEY, Buffer.from('garbage-not-aes-block!').toString('base64'))).toThrow()
  })

  it('大白话：回调外壳——验签不过绝不进业务处理；跨企业（receiveId≠本 corp）合法签名也拒；合法回调解出 Token/OpenKfId', async () => {
    const events: any[] = []
    const cb = defineKfCallback({
      token: () => 'tok',
      aesKey: () => AES_KEY,
      corpid: () => 'corp-1',
      onEvent: async (e) => void events.push(e),
    })
    const xml = '<xml><Token>sync-t</Token><OpenKfId>kf-1</OpenKfId></xml>'
    const mk = (receiveId: string, sigOk = true) => {
      const enc = encryptKf(AES_KEY, xml, receiveId)
      const sig = sigOk ? kfSignature('tok', '1', '2', enc) : 'bad-sig'
      return {
        httpMethod: 'POST',
        queryStringParameters: { msg_signature: sig, timestamp: '1', nonce: '2' },
        body: `<xml><Encrypt><![CDATA[${enc}]]></Encrypt></xml>`,
      }
    }
    await cb(mk('corp-1', false)) // 伪造签名
    expect(events.length).toBe(0)
    await cb(mk('corp-EVIL', true)) // 跨企业
    expect(events.length).toBe(0)
    const r = await cb(mk('corp-1', true)) // 合法
    expect(events.length).toBe(1)
    expect(events[0].syncToken).toBe('sync-t')
    expect(events[0].openKfId).toBe('kf-1')
    expect(r.statusCode).toBe(200)
  })

  it('大白话：GET 验 URL——签名对回明文回显；签名错回空', async () => {
    const cb = defineKfCallback({ token: () => 'tok', aesKey: () => AES_KEY, onEvent: async () => {} })
    const echostr = encryptKf(AES_KEY, 'PLAIN-ECHO', 'corp-1')
    const ok1 = await cb({
      httpMethod: 'GET',
      queryStringParameters: { msg_signature: kfSignature('tok', '1', '2', echostr), timestamp: '1', nonce: '2', echostr },
    })
    expect(ok1.body).toBe('PLAIN-ECHO')
    const bad = await cb({
      httpMethod: 'GET',
      queryStringParameters: { msg_signature: 'nope', timestamp: '1', nonce: '2', echostr },
    })
    expect(bad.body).toBe('')
  })
})

describe('会话态接管与令牌（黄金 §四/§十一）', () => {
  const fetchOf = (state: number, transErr = 0) => async (url: string) => ({
    json: async () => {
      if (url.includes('service_state/get')) return { service_state: state }
      if (url.includes('service_state/trans')) return transErr ? { errcode: transErr } : { errcode: 0 }
      return {}
    },
  })

  it('大白话：已是智能助手态直接放行；新会话先接管再放行；人工在接/排队/已结束让位不硬试；接管失败不硬发', async () => {
    const args = { openKfId: 'kf', externalUserId: 'eu' }
    expect(await ensureSmartAssistant('T', args, fetchOf(1) as any)).toBe('proceed')
    expect(await ensureSmartAssistant('T', args, fetchOf(0) as any)).toBe('proceed') // 0→1 接管
    expect(await ensureSmartAssistant('T', args, fetchOf(3) as any)).toBe('skip') // 人工在接·bot 不抢话
    expect(await ensureSmartAssistant('T', args, fetchOf(2) as any)).toBe('skip')
    expect(await ensureSmartAssistant('T', args, fetchOf(4) as any)).toBe('skip')
    expect(await ensureSmartAssistant('T', args, fetchOf(0, 95013) as any)).toBe('skip') // 接管失败
  })

  it('大白话：access_token 有效期内走缓存不重复请求；取失败抛错不返回坏令牌', async () => {
    let calls = 0
    const f = (async (url: string) => ({
      json: async () => {
        if (url.includes('gettoken')) {
          calls++
          return { access_token: 'tk-' + calls, expires_in: 7200 }
        }
        return {}
      },
    })) as any
    expect(await getAccessToken({ corpid: 'c', secret: 's' }, f)).toBe('tk-1')
    expect(await getAccessToken({ corpid: 'c', secret: 's' }, f)).toBe('tk-1') // 缓存命中
    expect(calls).toBe(1)

    const bad = (async () => ({ json: async () => ({ errcode: 40001 }) })) as any
    control.reset() // 清缓存
    await expect(getAccessToken({ corpid: 'c', secret: 's' }, bad)).rejects.toThrow()
  })

  it('大白话：fetch 抛错也绝不把 corpsecret 带进错误串（深审 2026-07-05·防 secret 进云日志）', async () => {
    control.reset()
    const SECRET = 'super-secret-xyz'
    // 模拟底层 fetch 把请求 URL（含 corpsecret）嵌进错误消息的最坏情形
    const leaky = (async (url: string) => {
      throw new Error('fetch failed to ' + url)
    }) as any
    let caught: Error | null = null
    await getAccessToken({ corpid: 'c', secret: SECRET }, leaky).catch((e) => (caught = e))
    expect(caught).toBeTruthy()
    expect(String(caught)).not.toContain(SECRET)
  })
})

describe('kfBind / dataConsent（黄金 §九/§三）', () => {
  it('大白话：无 unionid 拒；未配置拒；转换返空不写映射；成功建 ext→openid 幂等映射', async () => {
    expect((await call('kfBind', {})).error).toBe('NO_UNIONID')
    expect((await call('kfBind', { unionid: 'u1' })).error).toBe('KF_NOT_CONFIGURED')

    process.env.WXKF_CORPID = 'c'
    process.env.WXKF_SECRET = 's'
    stubFetch((url) => {
      if (url.includes('gettoken')) return { access_token: 'T', expires_in: 7200 }
      if (url.includes('idconvert')) return { external_userid: '' } // 无有效会话
      return {}
    })
    expect((await call('kfBind', { unionid: 'u1' })).error).toBe('NO_EXTERNAL_USERID')
    expect(control.dump('kfIdentity').length).toBe(0) // 不写

    control.reset()
    control.setOpenId('oME')
    stubFetch((url) => {
      if (url.includes('gettoken')) return { access_token: 'T', expires_in: 7200 }
      if (url.includes('idconvert')) return { external_userid: 'eu-9' }
      return {}
    })
    const r = await call('kfBind', { unionid: 'u1' })
    expect(r.bound).toBe(true)
    const m = control.dump('kfIdentity')[0]
    expect(m._id).toBe('ext:eu-9')
    expect(m.openid).toBe('oME')
  })

  it('大白话：同意写本人档记录时刻、可撤回；读闸联动——同意放行、撤回立即改判拒', async () => {
    await call('dataConsent', { agree: true })
    let u = control.dump('users')[0]
    expect(u._id).toBe('oME')
    expect(u.csDataShare.agreed).toBe(true)
    const db = { collection: (n: string) => ({ where: (f: any) => ({ limit: () => ({ get: async () => ({ data: control.dump(n).filter((d: any) => d._openid === f._openid) }) }) }) }) }
    expect((await assertDataShareConsent(db, 'oME')).ok).toBe(true)

    await call('dataConsent', { agree: false })
    u = control.dump('users')[0]
    expect(u.csDataShare.agreed).toBe(false)
    expect((await assertDataShareConsent(db, 'oME')).ok).toBe(false) // 撤回即拒
    expect((await assertDataShareConsent(db, '')).ok).toBe(false) // 空标识 fail-closed
  })
})

describe('csAccess 归属闸（黄金 §二）', () => {
  const dbOf = () => ({
    collection: (n: string) => ({
      doc: (id: string) => ({ get: async () => ({ data: control.dump(n).find((d: any) => d._id === id) || null }) }),
    }),
  })

  it('大白话：会话归本坐席才放行；归他人/不存在/缺标识/未认领（空归属）一律拒——防批量导出', async () => {
    control.seed('csSession', [
      { _id: 's1', agentId: 'agent-A', status: 'active' },
      { _id: 's2', agentId: '', status: 'pending' },
    ])
    const db = dbOf()
    expect((await assertOwnedByAgent(db, 'agent-A', 's1')).ok).toBe(true)
    expect((await assertOwnedByAgent(db, 'agent-B', 's1')).error).toBe('NOT_OWNER')
    expect((await assertOwnedByAgent(db, 'agent-A', 'ghost')).error).toBe('NO_SESSION')
    expect((await assertOwnedByAgent(db, '', 's1')).error).toBe('BAD_SCOPE')
    expect((await assertOwnedByAgent(db, 'agent-A', 's2')).error).toBe('NOT_OWNER') // 空归属不放行
  })
})

describe('kfSend / kfHealthProbe（黄金 §四/§十一·服务端专用）', () => {
  it('大白话：带身份的客户端调用一律拒；缺参拒；未配置拒', async () => {
    control.setOpenId('oHACK')
    expect(((await kfSend({ externalUserId: 'e', openKfId: 'k', text: 'hi' })) as any).error).toBe('SERVER_ONLY')
    control.setOpenId('')
    expect(((await kfSend({ externalUserId: '', openKfId: 'k', text: 'hi' })) as any).error).toBe('BAD_ARGS')
    expect(((await kfSend({ externalUserId: 'e', openKfId: 'k', text: 'hi' })) as any).error).toBe('KF_NOT_CONFIGURED')
  })

  it('大白话：探针——客户端拒；未配置报不健康；API 报错码报不健康；全通报健康', async () => {
    control.setOpenId('oHACK')
    expect(((await kfHealthProbe()) as any).error).toBe('SERVER_ONLY')
    control.setOpenId('')
    expect(((await kfHealthProbe()) as any).healthy).toBe(false) // 未配置

    process.env.WXKF_CORPID = 'c'
    process.env.WXKF_SECRET = 's'
    stubFetch((url) => {
      if (url.includes('gettoken')) return { access_token: 'T', expires_in: 7200 }
      if (url.includes('account/list')) return { errcode: 60020 }
      return {}
    })
    const r1: any = await kfHealthProbe()
    expect(r1.healthy).toBe(false)
    expect(r1.errcode).toBe(60020)

    control.reset()
    control.setOpenId('')
    stubFetch((url) => {
      if (url.includes('gettoken')) return { access_token: 'T', expires_in: 7200 }
      if (url.includes('account/list')) return { account_list: [{}] }
      return {}
    })
    expect(((await kfHealthProbe()) as any).healthy).toBe(true)
  })
})

// stubFetch 只支持纯 JSON 响应（无 headers()）；kf/media/get 成功回二进制、失败回 JSON——需要一个
// 能同时喂两种形状的桩（getAccessToken 走同一 globalThis.fetch，故 gettoken 也须过这个统一路由）。
const stubFetchMedia = (router: (url: string) => { json?: any; binary?: Buffer }) => {
  ;(globalThis as any).fetch = async (url: string) => {
    const r = router(url)
    if (r.binary) {
      const buf = r.binary
      return {
        headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? 'image/jpeg' : null) },
        json: async () => ({}),
        arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      }
    }
    return {
      headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? 'application/json' : null) },
      json: async () => r.json ?? {},
      arrayBuffer: async () => new ArrayBuffer(0),
    }
  }
}

describe('kf/media/get 下载 + kfMedia（B5·顾客发图坐席可见·平台接缝单点#12）', () => {
  it('大白话：二进制响应→拿到原样字节；JSON 错误响应（media_id 过期/失效）→统一按过期语义回传', async () => {
    stubFetchMedia((url) => {
      expect(url).toContain('kf/media/get')
      expect(url).toContain('media_id=m1')
      return { binary: Buffer.from('raw-image-bytes') }
    })
    const ok: any = await getKfMedia('T', 'm1')
    expect(ok.ok).toBe(true)
    expect(ok.buffer.toString()).toBe('raw-image-bytes') // 字节原样、非篡改（真实尺寸·根因#8）

    stubFetchMedia(() => ({ json: { errcode: 40007, errmsg: 'invalid media_id' } }))
    const bad: any = await getKfMedia('T', 'm1')
    expect(bad.ok).toBe(false)
    expect(bad.expired).toBe(true)
    expect(bad.errcode).toBe(40007)
  })

  it('大白话：kfMedia 服务端专用闸——带身份客户端调用拒；缺参拒；未配置拒；配齐后经服务端接缝下载并回 base64', async () => {
    control.setOpenId('oHACK')
    expect(((await kfMedia({ mediaId: 'm1' })) as any).error).toBe('SERVER_ONLY')
    control.setOpenId('')
    expect(((await kfMedia({ mediaId: '' })) as any).error).toBe('BAD_ARGS')
    expect(((await kfMedia({ mediaId: 'm1' })) as any).error).toBe('KF_NOT_CONFIGURED')

    process.env.WXKF_CORPID = 'c'
    process.env.WXKF_SECRET = 's'
    stubFetchMedia((url) => {
      if (url.includes('gettoken')) return { json: { access_token: 'T', expires_in: 7200 } }
      return { binary: Buffer.from('img-bytes') }
    })
    const r: any = await kfMedia({ mediaId: 'm1' })
    expect(r.ok).toBe(true)
    expect(Buffer.from(r.base64, 'base64').toString()).toBe('img-bytes')
  })

  it('大白话：kfMedia 下载失败（过期/其余错误码）原样透出 ok:false + expired 标记，不抛错', async () => {
    control.setOpenId('') // 默认 beforeEach 是 'oME'（客户端身份）——服务端专用函数须先清空 openid 才过 isServerCall 闸
    process.env.WXKF_CORPID = 'c'
    process.env.WXKF_SECRET = 's'
    stubFetchMedia((url) => {
      if (url.includes('gettoken')) return { json: { access_token: 'T', expires_in: 7200 } }
      return { json: { errcode: 40014 } }
    })
    const r: any = await kfMedia({ mediaId: 'm1' })
    expect(r.ok).toBe(false)
    expect(r.expired).toBe(true)
    expect(r.errcode).toBe(40014)
  })
})

describe('召回（黄金 §八·纯决策与 I/O 分离）', () => {
  it('大白话：四类候选各按其规则；太新/过窗不催付；有进度不召回；空输入安全；总数为四类之和', () => {
    const now = 100 * 60_000
    const r = recallCandidates({
      now,
      payWindowMs: 15 * 60_000,
      pendingOrders: [
        { id: 'fresh', status: 'pending', createdAt: now - 60_000 }, // 太新不催
        { id: 'nudge', status: 'pending', createdAt: now - 10 * 60_000 }, // 该催
        { id: 'over', status: 'pending', createdAt: now - 20 * 60_000 }, // 过窗不催
      ],
      shippedOrders: [
        { id: 'stuck', status: 'shipped', shippedAt: now - 8 * 86400_000 },
        { id: 'fine', status: 'shipped', shippedAt: now - 86400_000 },
      ],
      activations: [
        { _openid: 'u1', courseId: 'c1', enteredAt: null }, // 未开课
        { _openid: 'u2', courseId: 'c1', enteredAt: 1 }, // 进了没学
        { _openid: 'u3', courseId: 'c1', enteredAt: 1 }, // 有进度不召回
      ],
      progress: [{ _openid: 'u3', courseId: 'c1' }],
    })
    expect(r.unpaid).toEqual(['nudge'])
    expect(r.logistics).toEqual(['stuck'])
    expect(r.unstarted).toEqual(['u1'])
    expect(r.unfinished).toEqual(['u2'])
    expect(r.total).toBe(4)
    expect(recallCandidates({ now, payWindowMs: 1, pendingOrders: [], shippedOrders: [], activations: [], progress: [] }).total).toBe(0)
  })

  it('大白话：扫描仅服务端触发——客户端带身份调用跳过不扫不推', async () => {
    control.setOpenId('oHACK')
    expect(((await recallScan()) as any).skipped).toBe(true)
    control.setOpenId('')
    const r: any = await recallScan()
    expect(r.total).toBe(0) // 空库
  })
})

// 变异测试幸存者击杀（kit/wecom.ts·企业微信客服平台接缝·根因#12 单点）。
// StrykerJS 首轮该文件 265 个变异体幸存/无覆盖（变异分 52.1%）——本文件补 A 类（真测试缺口）：
//   ① WXBizMsgCrypt 纯算法逐边界钉死：kfSignature 已知答案（sort/join 削掉必红）、PKCS7 padding
//      合法边界（pad=1 / pad=32）与非法样本（pad=0 / pad>32 / pad>密文长 / pad==密文长）逐条对
//      定型错误码（BAD_PADDING/BAD_PLAINTEXT/BAD_MSGLEN 一字不差·靠人#8：密文走完整形状到最后一步）；
//   ② defineKfCallback 防伪细化（根因#3 全场最关键）：token 为空即拒（削 !token 守卫→空口令签名照样
//      通过=伪造通道）、GET receiveId 绑定、告警码 FORGED_CALLBACK/DECRYPT_FAILED/RECEIVEID_MISMATCH
//      逐字留痕（[LD_ALERT] 行即告警契约）、回包恒空文本 + text/plain 头；
//   ③ access_token 缓存语义：5 分钟提前量、过期/边界/类型脏数据（expireAt 字符串）必重取、
//      errcode+access_token 同现必拒（|| 削成 && 就放行坏令牌）、expires_in 缺省 7200；
//   ④ 各 API 请求形状契约（sync_msg/send_msg/message/send/service_state/idconvert/batchget/media
//      的 URL 路径 + POST + JSON 头 + payload 整包 toEqual——对端是真实企微 API，形状错=真机必挂）；
//   ⑤ 无全局 fetch 的 node https 降级线（vi.mock('https') 内存桩·JSON 形态 + 二进制形态各钉一遍；
//      真实企微对端联通属根因#8 真机域，此处不冒充）。
// 期望值全部取自 wecom.ts 源码常量/注释与企微协议注释（WXBizMsgCrypt 格式、service_state 语义），未发明行为。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import crypto from 'node:crypto'
import { control } from 'wx-server-sdk'
import {
  kfSignature,
  verifyKfSignature,
  decryptKfMessage,
  defineKfCallback,
  getAccessToken,
  getCachedKfToken,
  syncMsg,
  getWecomOAuthUserId,
  AGENT_DESK_URL,
  sendAppMessage,
  sendAgentCard,
  getServiceState,
  enterSmartAssistant,
  ensureSmartAssistant,
  unionidToExternalUserid,
  listKfAccounts,
  kfCustomerBatchget,
  getKfMedia,
  kfSendText,
  kfFetchMedia,
} from '../src/kit/wecom'
import { getDb } from '../src/kit/db'

// —— node https 内存桩（击杀 httpsFetch/httpsFetchBin 降级线的无覆盖变异·不碰真实网络）——
// vi.mock 工厂被提升到 import 前，共享状态须走 vi.hoisted。同时给 default 与 named（wecom 用
// `import https from 'https'` 默认导入，botpush 用 named——各测试文件各自 mock，互不影响）。
const h = vi.hoisted(() => ({
  responseBody: '' as string, // JSON 线回包（Buffer 化后按 data/end 事件发出）
  responseChunks: null as Buffer[] | null, // 二进制线回包分片（指定时优先·验多分片重组）
  responseHeaders: {} as Record<string, string>,
  emitError: false,
  calls: [] as Array<{ options: Record<string, unknown>; written: string }>,
}))
vi.mock('https', () => {
  const request = (options: Record<string, unknown>, onRes: (res: unknown) => void) => {
    const call = { options, written: '' }
    h.calls.push(call)
    const reqHandlers: Record<string, (...a: unknown[]) => void> = {}
    return {
      on(ev: string, cb: (...a: unknown[]) => void) {
        reqHandlers[ev] = cb
      },
      write(chunk: string) {
        call.written += chunk
      },
      end() {
        queueMicrotask(() => {
          if (h.emitError) {
            if (reqHandlers['error']) reqHandlers['error'](new Error('sock boom'))
            return // error 事件名被削→悬挂→超时即击杀
          }
          const resHandlers: Record<string, Array<(...a: unknown[]) => void>> = {}
          onRes({
            headers: h.responseHeaders,
            on(ev: string, cb: (...a: unknown[]) => void) {
              ;(resHandlers[ev] = resHandlers[ev] || []).push(cb)
            },
          })
          queueMicrotask(() => {
            const chunks = h.responseChunks ?? (h.responseBody ? [Buffer.from(h.responseBody)] : [])
            for (const c of chunks) for (const cb of resHandlers['data'] || []) cb(c)
            for (const cb of resHandlers['end'] || []) cb()
          })
        })
      },
    }
  }
  return { default: { request }, request }
})

// —— WXBizMsgCrypt 正向构造（与 decryptKfMessage 互为逆运算·padding 可控以打边界）——
const AES_KEY = 'a'.repeat(43)
const keyOf = () => Buffer.from(AES_KEY + '=', 'base64')
function cbcEncrypt(plain: Buffer): string {
  const key = keyOf()
  const cipher = crypto.createCipheriv('aes-256-cbc', key, key.subarray(0, 16))
  cipher.setAutoPadding(false)
  return Buffer.concat([cipher.update(plain), cipher.final()]).toString('base64')
}
function pack(msg: string, receiveId: string): Buffer {
  const m = Buffer.from(msg, 'utf8')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(m.length, 0)
  return Buffer.concat([Buffer.alloc(16, 7), len, m, Buffer.from(receiveId, 'utf8')])
}
function padded(buf: Buffer): Buffer {
  const pad = 32 - (buf.length % 32) // %32==0 时补满一整块 32（WXBizMsgCrypt 规范）
  const p = pad === 0 ? 32 : pad
  return Buffer.concat([buf, Buffer.alloc(p, p)])
}
const encryptKf = (msg: string, receiveId: string) => cbcEncrypt(padded(pack(msg, receiveId)))

// —— alert 是 console.error 单行 [LD_ALERT]（kit/observe 契约）——spy 捕获逐字断言 ——
let errSpy: ReturnType<typeof vi.spyOn>
let logSpy: ReturnType<typeof vi.spyOn>
const alertLines = () => errSpy.mock.calls.map((c: unknown[]) => String(c[0])).filter((s: string) => s.startsWith('[LD_ALERT]'))

beforeEach(() => {
  control.reset()
  h.responseBody = ''
  h.responseChunks = null
  h.responseHeaders = {}
  h.emitError = false
  h.calls.length = 0
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  errSpy.mockRestore()
  logSpy.mockRestore()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

// spy 版 JSON fetchImpl：记录 url/init 并按路由回包（同 botpush 击杀文件的手写 fake 风格）
function spyFetch(router: (url: string, body?: any) => unknown = () => ({})) {
  const calls: Array<{ url: string; init: { method?: string; headers?: Record<string, string>; body?: string } }> = []
  const impl = async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    calls.push({ url: String(url), init: init || {} })
    return { json: async () => router(String(url), init?.body ? JSON.parse(init.body) : undefined) }
  }
  const body = (i: number) => JSON.parse(calls[i].init.body || 'null')
  return { calls, impl, body }
}

describe('kfSignature / 解密 padding 边界（WXBizMsgCrypt 纯算法·靠人#8 完整形状）', () => {
  it('大白话：签名=sha1(四要素字典序拼接)——已知答案逐字对（把 sort 或 join 削掉必红）', () => {
    // sort(['tok','111','222','ENC']) = ['111','222','ENC','tok']（数字<大写<小写）
    const expected = crypto.createHash('sha1').update('111222ENCtok').digest('hex')
    expect(kfSignature('tok', '111', '222', 'ENC')).toBe(expected)
    expect(verifyKfSignature('tok', '111', '222', 'ENC', expected)).toBe(true)
  })

  it('大白话：pad=1 与 pad=32 都是合法 padding（>=1、<=32 边界各自收紧一格必红）', () => {
    // 16+4+5+6=31 → pad=1
    expect(decryptKfMessage(AES_KEY, encryptKf('hello', 'corp-1'))).toEqual({ message: 'hello', receiveId: 'corp-1' })
    // 16+4+6+6=32 → 补满一整块 pad=32
    expect(decryptKfMessage(AES_KEY, encryptKf('abcdef', 'corp12'))).toEqual({ message: 'abcdef', receiveId: 'corp12' })
  })

  it('大白话：空消息+空 receiveId（明文恰 4 字节）是合法形状——длina 判定收紧成 <=4 / msgLen<=0 / >= 都必红', () => {
    expect(decryptKfMessage(AES_KEY, encryptKf('', ''))).toEqual({ message: '', receiveId: '' })
  })

  it('大白话：pad 字节=0 → 恰好 BAD_PADDING（不是别的错、更不是吐数据）', () => {
    const plain = Buffer.concat([Buffer.alloc(31, 9), Buffer.from([0])])
    expect(() => decryptKfMessage(AES_KEY, cbcEncrypt(plain))).toThrow('BAD_PADDING')
  })

  it('大白话：pad 字节(20)超过密文总长(16) → BAD_PADDING（削掉 pad>buf.length 检查会吐错位切片）', () => {
    const plain = Buffer.concat([Buffer.alloc(15, 9), Buffer.from([20])])
    expect(() => decryptKfMessage(AES_KEY, cbcEncrypt(plain))).toThrow('BAD_PADDING')
  })

  it('大白话：pad 字节(200)>32 → BAD_PADDING（削掉 <=32 检查会滑进 msgLen 分支变别的错）', () => {
    const plain = Buffer.alloc(224, 0xff)
    plain[223] = 200
    expect(() => decryptKfMessage(AES_KEY, cbcEncrypt(plain))).toThrow('BAD_PADDING')
  })

  it('大白话：pad 恰等于密文长（32=32）合法过 padding、但明文剩 0 字节 → BAD_PLAINTEXT（> 收紧成 >= 必红）', () => {
    const plain = Buffer.concat([Buffer.alloc(31, 9), Buffer.from([32])])
    expect(() => decryptKfMessage(AES_KEY, cbcEncrypt(plain))).toThrow('BAD_PLAINTEXT')
  })

  it('大白话：去 pad 后不足 4 字节 → 恰好 BAD_PLAINTEXT（削掉检查会变 readUInt32 的 RangeError）', () => {
    const plain = padded(Buffer.concat([Buffer.alloc(16, 7), Buffer.from([1, 2])]))
    expect(() => decryptKfMessage(AES_KEY, cbcEncrypt(plain))).toThrow('BAD_PLAINTEXT')
  })

  it('大白话：声明 msgLen(9999) 超过实际数据 → 恰好 BAD_MSGLEN，绝不返回错位切片', () => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(9999, 0)
    const plain = padded(Buffer.concat([Buffer.alloc(16, 7), len, Buffer.from('short')]))
    expect(() => decryptKfMessage(AES_KEY, cbcEncrypt(plain))).toThrow('BAD_MSGLEN')
  })
})

describe('defineKfCallback 防伪细化（根因#3 fail-closed·告警码逐字留痕）', () => {
  const GET = (echostr: string, sig: string) => ({
    httpMethod: 'GET',
    queryStringParameters: { msg_signature: sig, timestamp: '1', nonce: '2', echostr },
  })
  const POST = (encStr: string, sig: string) => ({
    httpMethod: 'POST',
    queryStringParameters: { msg_signature: sig, timestamp: '1', nonce: '2' },
    body: `<xml><Encrypt><![CDATA[${encStr}]]></Encrypt></xml>`,
  })
  // 确定性解密失败样本：末字节 pad=0 → decryptKfMessage 必抛（不用随机垃圾，防偶然可解）
  const badCipher = () => cbcEncrypt(Buffer.concat([Buffer.alloc(31, 9), Buffer.from([0])]))

  it('大白话：GET——token 没配（空串）时就算签名「配得上空口令」也一律回空（削 !token 守卫=开伪造通道）', async () => {
    const cb = defineKfCallback({ creds: () => ({ token: '', aesKey: AES_KEY }), onEvent: async () => {} })
    const echostr = encryptKf('LEAK-ME', 'corp-1')
    const r = await cb(GET(echostr, kfSignature('', '1', '2', echostr)))
    expect(r.body).toBe('')
  })

  it('大白话：GET——配了 corpid 后，别家企业(receiveId 不符)的合法密文验 URL 失败回空', async () => {
    const cb = defineKfCallback({ creds: () => ({ token: 'tok', aesKey: AES_KEY, corpid: 'corp-1' }), onEvent: async () => {} })
    const echostr = encryptKf('PLAIN', 'corp-EVIL')
    const r = await cb(GET(echostr, kfSignature('tok', '1', '2', echostr)))
    expect(r.body).toBe('')
  })

  it('大白话：GET——签名对但密文烂（解密抛错）→ 静默回空，不告警也不抛穿；回包头恒 text/plain', async () => {
    const cb = defineKfCallback({ creds: () => ({ token: 'tok', aesKey: AES_KEY }), onEvent: async () => {} })
    const echostr = badCipher()
    const r = await cb(GET(echostr, kfSignature('tok', '1', '2', echostr)))
    expect(r).toEqual({ statusCode: 200, headers: { 'Content-Type': 'text/plain' }, body: '' })
    expect(alertLines()).toEqual([]) // catch 被掏空会掉进 POST 支多打 FORGED 告警——必红
  })

  it('大白话：POST——token 为空的「空口令签名」绝不进 onEvent，告警逐字 FORGED_CALLBACK、回包恒空', async () => {
    const events: unknown[] = []
    const cb = defineKfCallback({ creds: () => ({ token: '', aesKey: AES_KEY }), onEvent: async (e) => void events.push(e) })
    const enc = encryptKf('<xml><Token>t</Token></xml>', 'x')
    const r = await cb(POST(enc, kfSignature('', '1', '2', enc)))
    expect(events.length).toBe(0)
    expect(r.body).toBe('')
    expect(alertLines()).toEqual(['[LD_ALERT] sev=security fn=kfCallback code=FORGED_CALLBACK ctx={}'])
  })

  it('大白话：POST——body 里没有 <Encrypt>（哪怕签名对着空串算）→ 走 FORGED 告警，不是解密失败', async () => {
    const cb = defineKfCallback({ creds: () => ({ token: 'tok', aesKey: AES_KEY }), onEvent: async () => {} })
    const r = await cb({
      httpMethod: 'POST',
      queryStringParameters: { msg_signature: kfSignature('tok', '1', '2', ''), timestamp: '1', nonce: '2' },
      body: '<xml></xml>',
    })
    expect(r.body).toBe('')
    expect(alertLines()).toEqual(['[LD_ALERT] sev=security fn=kfCallback code=FORGED_CALLBACK ctx={}'])
  })

  it('大白话：POST——签名对但密文烂 → DECRYPT_FAILED 告警逐字留痕、回空、绝不抛穿', async () => {
    const events: unknown[] = []
    const cb = defineKfCallback({ creds: () => ({ token: 'tok', aesKey: AES_KEY }), onEvent: async (e) => void events.push(e) })
    const enc = badCipher()
    const r = await cb(POST(enc, kfSignature('tok', '1', '2', enc)))
    expect(events.length).toBe(0)
    expect(r.body).toBe('')
    expect(alertLines()).toEqual(['[LD_ALERT] sev=security fn=kfCallback code=DECRYPT_FAILED ctx={}'])
  })

  it('大白话：POST——跨企业合法签名 → RECEIVEID_MISMATCH 告警逐字留痕、回空、不进 onEvent', async () => {
    const events: unknown[] = []
    const cb = defineKfCallback({
      creds: () => ({ token: 'tok', aesKey: AES_KEY, corpid: 'corp-1' }),
      onEvent: async (e) => void events.push(e),
    })
    const enc = encryptKf('<xml><Token>t</Token></xml>', 'corp-EVIL')
    const r = await cb(POST(enc, kfSignature('tok', '1', '2', enc)))
    expect(events.length).toBe(0)
    expect(r.body).toBe('')
    expect(alertLines()).toEqual(['[LD_ALERT] sev=security fn=kfCallback code=RECEIVEID_MISMATCH ctx={}'])
  })

  it('大白话：POST 合法回调——回包恒空文本；XML 缺 OpenKfId 标签就给空串（不是编造值）；不打告警', async () => {
    const events: any[] = []
    const cb = defineKfCallback({ creds: () => ({ token: 'tok', aesKey: AES_KEY }), onEvent: async (e) => void events.push(e) })
    const enc = encryptKf('<xml><Token>sync-9</Token></xml>', 'corp-1')
    const r = await cb(POST(enc, kfSignature('tok', '1', '2', enc)))
    expect(events).toEqual([{ syncToken: 'sync-9', openKfId: '', raw: '<xml><Token>sync-9</Token></xml>' }])
    expect(r).toEqual({ statusCode: 200, headers: { 'Content-Type': 'text/plain' }, body: '' })
    expect(alertLines()).toEqual([])
  })

  it('大白话：POST body 是 base64 包裹（isBase64Encoded）也解得开、照常进 onEvent', async () => {
    const events: any[] = []
    const cb = defineKfCallback({ creds: () => ({ token: 'tok', aesKey: AES_KEY }), onEvent: async (e) => void events.push(e) })
    const enc = encryptKf('<xml><Token>b64</Token></xml>', 'corp-1')
    const ev = POST(enc, kfSignature('tok', '1', '2', enc))
    const r = await cb({ ...ev, isBase64Encoded: true, body: Buffer.from(ev.body).toString('base64') })
    expect(events.length).toBe(1)
    expect(events[0].syncToken).toBe('b64')
    expect(r.body).toBe('')
  })
})

describe('getAccessToken 缓存语义（7200s·5 分钟提前量·脏数据防御）', () => {
  const T = 1_800_000_000_000 // 固定系统时间，边界断言确定性

  it('大白话：回包没带 expires_in 就按 7200s 兜底缓存——第二次调用不再打 gettoken', async () => {
    let calls = 0
    const f = (async () => ({ json: async () => ({ access_token: 'TK', ...(calls++ ? {} : {}) }) })) as any
    expect(await getAccessToken({ corpid: 'c', secret: 's' }, f)).toBe('TK')
    expect(await getAccessToken({ corpid: 'c', secret: 's' }, f)).toBe('TK')
    expect(calls).toBe(1)
  })

  it('大白话：缓存还剩 1 分钟（<5 分钟提前量）视为将失效——必须重取新令牌，不吃老本', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(T)
    control.seed('kfState', [{ _id: 'token', accessToken: 'OLD', expireAt: T + 60_000 }])
    const { calls, impl } = spyFetch(() => ({ access_token: 'NEW', expires_in: 7200 }))
    expect(await getAccessToken({ corpid: 'c', secret: 's' }, impl as any)).toBe('NEW')
    expect(calls.length).toBe(1)
  })

  it('大白话：恰好卡在提前量边界（expireAt-5min == now）也算过期重取（> 松成 >= 必红）', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(T)
    control.seed('kfState', [{ _id: 'token', accessToken: 'OLD', expireAt: T + 5 * 60_000 }])
    const { impl } = spyFetch(() => ({ access_token: 'NEW', expires_in: 7200 }))
    expect(await getAccessToken({ corpid: 'c', secret: 's' }, impl as any)).toBe('NEW')
  })

  it('大白话：缓存里 expireAt 是字符串（脏数据）不认——typeof 检查削掉后字符串减法照样算数就漏了', async () => {
    control.seed('kfState', [{ _id: 'token', accessToken: 'OLD', expireAt: '99999999999999999' }])
    const { impl } = spyFetch(() => ({ access_token: 'NEW', expires_in: 7200 }))
    expect(await getAccessToken({ corpid: 'c', secret: 's' }, impl as any)).toBe('NEW')
  })

  it('大白话：fetch 炸了 → 恰好抛 GETTOKEN_FETCH_FAIL（消毒后的定型码）+ 告警逐字留痕', async () => {
    const boom = (async () => {
      throw new Error('conn reset')
    }) as any
    await expect(getAccessToken({ corpid: 'c', secret: 's' }, boom)).rejects.toThrow('GETTOKEN_FETCH_FAIL')
    expect(alertLines()).toEqual(['[LD_ALERT] sev=security fn=wecom code=GETTOKEN_FETCH_FAIL ctx={}'])
  })

  it('大白话：errcode 和 access_token 同现（|| 削成 && 的口子）→ 照样拒，抛 GETTOKEN_FAILED:40001 带原码告警', async () => {
    const f = (async () => ({ json: async () => ({ errcode: 40001, access_token: 'evil' }) })) as any
    await expect(getAccessToken({ corpid: 'c', secret: 's' }, f)).rejects.toThrow('GETTOKEN_FAILED:40001')
    expect(alertLines()).toEqual(['[LD_ALERT] sev=security fn=wecom code=GETTOKEN_FAILED ctx={"errcode":40001}'])
  })

  it('大白话：回包啥都没有（errcode=0 且无 token）也拒——不返回 undefined 当令牌用', async () => {
    const f = (async () => ({ json: async () => ({}) })) as any
    await expect(getAccessToken({ corpid: 'c', secret: 's' }, f)).rejects.toThrow('GETTOKEN_FAILED')
  })
})

describe('getCachedKfToken（只读缓存·不持密钥·best-effort）', () => {
  const T = 1_800_000_000_000

  it('大白话：未过期返令牌；剩 1 分钟算将失效返空；expireAt 是字符串（脏数据）返空', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(T)
    control.seed('kfState', [{ _id: 'token', accessToken: 'CACHED', expireAt: T + 7200_000 }])
    expect(await getCachedKfToken(getDb())).toBe('CACHED')
    control.reset()
    control.seed('kfState', [{ _id: 'token', accessToken: 'CACHED', expireAt: T + 60_000 }])
    expect(await getCachedKfToken(getDb())).toBe('')
    control.reset()
    control.seed('kfState', [{ _id: 'token', accessToken: 'CACHED', expireAt: '99999999999999999' }])
    expect(await getCachedKfToken(getDb())).toBe('')
  })

  it('大白话：恰卡边界（expireAt-5min == now）返空（> 松成 >= 必红）；无档返空', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(T)
    control.seed('kfState', [{ _id: 'token', accessToken: 'CACHED', expireAt: T + 5 * 60_000 }])
    expect(await getCachedKfToken(getDb())).toBe('')
    control.reset()
    expect(await getCachedKfToken(getDb())).toBe('')
  })
})

describe('syncMsg 请求形状与回包归一（对端是真实企微 API·形状即契约）', () => {
  it('大白话：缺省参数——cursor 补空串、limit 补 1000；POST + JSON 头；回包缺字段全部归一', async () => {
    const { calls, impl, body } = spyFetch(() => ({}))
    const r = await syncMsg('T', { token: 'st' }, impl as any)
    expect(calls[0].url).toBe('https://qyapi.weixin.qq.com/cgi-bin/kf/sync_msg?access_token=T')
    expect(calls[0].init.method).toBe('POST')
    expect(calls[0].init.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(body(0)).toEqual({ cursor: '', token: 'st', limit: 1000 }) // open_kfid undefined 不落 JSON
    expect(r).toEqual({ next_cursor: '', has_more: 0, msg_list: [], errcode: undefined })
  })

  it('大白话：显式参数逐字透传；has_more/next_cursor/msg_list/errcode 原样带回', async () => {
    const { impl, body } = spyFetch(() => ({ next_cursor: 'n2', has_more: 1, msg_list: [{ msgid: 'm1' }], errcode: 0 }))
    const r = await syncMsg('T', { cursor: 'c1', token: 'st', openKfId: 'kf1', limit: 5 }, impl as any)
    expect(body(0)).toEqual({ cursor: 'c1', token: 'st', limit: 5, open_kfid: 'kf1' })
    expect(r).toEqual({ next_cursor: 'n2', has_more: 1, msg_list: [{ msgid: 'm1' }], errcode: 0 })
  })
})

describe('getWecomOAuthUserId（code→userid·fail-closed）', () => {
  it('大白话：URL 带对 access_token 和 code；有 userid 返 userid；errcode 同现 userid 也拒（|| 削成 && 必红）', async () => {
    const { calls, impl } = spyFetch(() => ({ userid: 'zhang' }))
    expect(await getWecomOAuthUserId('T', 'CODE9', impl as any)).toBe('zhang')
    expect(calls[0].url).toBe('https://qyapi.weixin.qq.com/cgi-bin/auth/getuserinfo?access_token=T&code=CODE9')
    const { impl: bad } = spyFetch(() => ({ errcode: 40029, userid: 'zhang' }))
    expect(await getWecomOAuthUserId('T', 'CODE9', bad as any)).toBe('')
    const { impl: none } = spyFetch(() => ({ openid: 'oNotMember' }))
    expect(await getWecomOAuthUserId('T', 'CODE9', none as any)).toBe('')
  })
})

describe('应用消息（message/send 单接缝·textcard 契约）', () => {
  it('大白话：坐席台 URL 单源常量逐字对（env 未配时的缺省值）', () => {
    expect(AGENT_DESK_URL).toBe('https://www.luckyducky.cn/agent/')
  })

  it('大白话：sendAppMessage——touser 用 | 连接、msgtype textcard、btntxt 显式给就用给的；整包逐字对、回包原样返回', async () => {
    const { calls, impl, body } = spyFetch(() => ({ errcode: 0, invaliduser: '' }))
    const r = await sendAppMessage(
      'T',
      { agentid: 1000002, touser: ['w1', 'w2'], textcard: { title: '新会话', description: '顾客等待', url: 'https://x/agent/', btntxt: '去处理' } },
      impl as any
    )
    expect(calls[0].url).toBe('https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=T')
    expect(body(0)).toEqual({
      touser: 'w1|w2',
      msgtype: 'textcard',
      agentid: 1000002,
      textcard: { title: '新会话', description: '顾客等待', url: 'https://x/agent/', btntxt: '去处理' },
    })
    expect(r).toEqual({ errcode: 0, invaliduser: '' })
  })

  it('大白话：btntxt 不给就兜底「接待」；touser 传空/缺失也不炸（拼成空串）', async () => {
    const { impl, body } = spyFetch(() => ({ errcode: 0 }))
    await sendAppMessage('T', { agentid: '1000002', touser: undefined as unknown as string[], textcard: { title: 't', description: 'd', url: 'u' } }, impl as any)
    expect(body(0)).toEqual({ touser: '', msgtype: 'textcard', agentid: '1000002', textcard: { title: 't', description: 'd', url: 'u', btntxt: '接待' } })
  })

  it('大白话：sendAgentCard 全配齐——过滤空收件人后逐字整包发出（agentId 读 secureConfig、令牌读缓存）', async () => {
    control.seed('secureConfig', [{ _id: 'wxkf', agentId: '1000002' }])
    control.seed('kfState', [{ _id: 'token', accessToken: 'CTK', expireAt: Date.now() + 7200_000 }])
    const { calls, impl, body } = spyFetch(() => ({ errcode: 0 }))
    await sendAgentCard(getDb(), ['w1', '', 'w2'], { title: '新会话待接', description: '排队 1 人', url: 'https://x/agent/?session=s1' }, impl as any)
    expect(calls.length).toBe(1)
    expect(calls[0].url).toBe('https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=CTK')
    expect(body(0)).toEqual({
      touser: 'w1|w2',
      msgtype: 'textcard',
      agentid: '1000002',
      textcard: { title: '新会话待接', description: '排队 1 人', url: 'https://x/agent/?session=s1', btntxt: '接待' },
    })
  })

  it('大白话：收件人为空（全空串/undefined）/未配 agentId/无缓存令牌——三关任一不齐就一个包都不发', async () => {
    const { calls, impl } = spyFetch(() => ({ errcode: 0 }))
    const card = { title: 't', description: 'd', url: 'u' }
    await sendAgentCard(getDb(), [''], card, impl as any) // 收件人过滤后为空
    await sendAgentCard(getDb(), undefined as unknown as string[], card, impl as any) // 兜底空数组
    control.seed('kfState', [{ _id: 'token', accessToken: 'CTK', expireAt: Date.now() + 7200_000 }])
    await sendAgentCard(getDb(), ['w1'], card, impl as any) // 有令牌但没配 agentId
    control.seed('secureConfig', [{ _id: 'wxkf', agentId: '1000002' }])
    control.reset() // 清掉令牌重来：只配 agentId 没令牌
    control.seed('secureConfig', [{ _id: 'wxkf', agentId: '1000002' }])
    await sendAgentCard(getDb(), ['w1'], card, impl as any)
    expect(calls.length).toBe(0)
  })

  it('大白话：fail-soft 铁律——发送环节炸了也绝不抛穿（推送不反噬转人工主流程）', async () => {
    control.seed('secureConfig', [{ _id: 'wxkf', agentId: '1000002' }])
    control.seed('kfState', [{ _id: 'token', accessToken: 'CTK', expireAt: Date.now() + 7200_000 }])
    const boom = (async () => {
      throw new Error('net down')
    }) as any
    await expect(sendAgentCard(getDb(), ['w1'], { title: 't', description: 'd', url: 'u' }, boom)).resolves.toBeUndefined()
  })
})

describe('会话态（service_state 读/转/决策·防 95018）', () => {
  it('大白话：读态请求形状逐字对；正常回数字；缺字段回 -1；errcode 回 -1 且告警带原码', async () => {
    const { calls, impl, body } = spyFetch(() => ({ service_state: 3 }))
    expect(await getServiceState('T', { openKfId: 'kf1', externalUserId: 'eu1' }, impl as any)).toBe(3)
    expect(calls[0].url).toBe('https://qyapi.weixin.qq.com/cgi-bin/kf/service_state/get?access_token=T')
    expect(body(0)).toEqual({ open_kfid: 'kf1', external_userid: 'eu1' })
    expect(alertLines()).toEqual([])

    const { impl: empty } = spyFetch(() => ({}))
    expect(await getServiceState('T', { openKfId: 'kf1', externalUserId: 'eu1' }, empty as any)).toBe(-1)

    const { impl: bad } = spyFetch(() => ({ errcode: 95000 }))
    expect(await getServiceState('T', { openKfId: 'kf1', externalUserId: 'eu1' }, bad as any)).toBe(-1)
    expect(alertLines()).toEqual(['[LD_ALERT] sev=security fn=wecom code=SERVICE_STATE_GET_FAILED ctx={"errcode":95000}'])
  })

  it('大白话：enterSmartAssistant 转态请求整包逐字对（service_state 恒 1·不带 servicer_userid）', async () => {
    const { calls, impl, body } = spyFetch(() => ({ errcode: 0 }))
    await enterSmartAssistant('T', { openKfId: 'kf1', externalUserId: 'eu1' }, impl as any)
    expect(calls[0].url).toBe('https://qyapi.weixin.qq.com/cgi-bin/kf/service_state/trans?access_token=T')
    expect(body(0)).toEqual({ open_kfid: 'kf1', external_userid: 'eu1', service_state: 1 })
  })

  it('大白话：读态失败(-1)也尽力接管转 1 再放行（把 -1 分支削掉就直接让位了）；实测态照常打点', async () => {
    const urls: string[] = []
    const f = (async (url: string) => {
      urls.push(String(url))
      return { json: async () => (String(url).includes('service_state/get') ? { errcode: 95000 } : { errcode: 0 }) }
    }) as any
    expect(await ensureSmartAssistant('T', { openKfId: 'kf1', externalUserId: 'eu1' }, f)).toBe('proceed')
    expect(urls.some((u) => u.includes('service_state/trans'))).toBe(true)
    expect(logSpy).toHaveBeenCalledWith('[kf] service-state', { state: -1 })
  })

  it('大白话：接管新会话(0→1)失败=真异常——告警逐字带 errcode 与来路态、返 skip 不硬发', async () => {
    const f = (async (url: string) => ({
      json: async () => (String(url).includes('service_state/get') ? { service_state: 0 } : { errcode: 95013 }),
    })) as any
    expect(await ensureSmartAssistant('T', { openKfId: 'kf1', externalUserId: 'eu1' }, f)).toBe('skip')
    expect(alertLines()).toEqual(['[LD_ALERT] sev=security fn=wecom code=ENTER_ASSISTANT_FAILED ctx={"errcode":95013,"fromState":0}'])
  })
})

describe('身份转换 / 探活 / 顾客反查（请求形状 + fail-closed 语义）', () => {
  it('大白话：idconvert——payload 逐字 {unionid,openid}；成功返 external_userid；errcode 同现也拒并告警带原码', async () => {
    const { calls, impl, body } = spyFetch(() => ({ external_userid: 'eu-9' }))
    expect(await unionidToExternalUserid('T', 'u1', 'o1', impl as any)).toBe('eu-9')
    expect(calls[0].url).toBe('https://qyapi.weixin.qq.com/cgi-bin/idconvert/unionid_to_external_userid?access_token=T')
    expect(body(0)).toEqual({ unionid: 'u1', openid: 'o1' })

    const { impl: bad } = spyFetch(() => ({ errcode: 48002, external_userid: 'leak' }))
    expect(await unionidToExternalUserid('T', 'u1', 'o1', bad as any)).toBe('')
    expect(alertLines()).toEqual(['[LD_ALERT] sev=security fn=wecom code=IDCONVERT_FAILED ctx={"errcode":48002}'])

    const { impl: none } = spyFetch(() => ({}))
    expect(await unionidToExternalUserid('T', 'u1', 'o1', none as any)).toBe('')
  })

  it('大白话：探活 listKfAccounts——轻量读 offset:0 limit:1 逐字、原始响应原样返回（含 errcode）', async () => {
    const { calls, impl, body } = spyFetch(() => ({ errcode: 60020, errmsg: 'not allow to access from your ip' }))
    const r = await listKfAccounts('T', impl as any)
    expect(calls[0].url).toBe('https://qyapi.weixin.qq.com/cgi-bin/kf/account/list?access_token=T')
    expect(body(0)).toEqual({ offset: 0, limit: 1 })
    expect(r).toEqual({ errcode: 60020, errmsg: 'not allow to access from your ip' })
  })

  it('大白话：kfCustomerBatchget——payload 逐字单元素列表；有 unionid 返 unionid；没授权(无 unionid)返空不编造', async () => {
    const { calls, impl, body } = spyFetch(() => ({ customer_list: [{ external_userid: 'eu1', unionid: 'u-9' }] }))
    expect(await kfCustomerBatchget('T', 'eu1', impl as any)).toBe('u-9')
    expect(calls[0].url).toBe('https://qyapi.weixin.qq.com/cgi-bin/kf/customer/batchget?access_token=T')
    expect(body(0)).toEqual({ external_userid_list: ['eu1'] })
    expect(alertLines()).toEqual([])

    const { impl: noUnion } = spyFetch(() => ({ customer_list: [{ external_userid: 'eu1' }] }))
    expect(await kfCustomerBatchget('T', 'eu1', noUnion as any)).toBe('')
    const { impl: emptyList } = spyFetch(() => ({}))
    expect(await kfCustomerBatchget('T', 'eu1', emptyList as any)).toBe('')
  })

  it('大白话：kfCustomerBatchget errcode（哪怕同时带着 customer_list）→ 返空 + 告警带原码', async () => {
    const { impl } = spyFetch(() => ({ errcode: 40003, customer_list: [{ unionid: 'leak' }] }))
    expect(await kfCustomerBatchget('T', 'eu1', impl as any)).toBe('')
    expect(alertLines()).toEqual(['[LD_ALERT] sev=security fn=wecom code=KF_BATCHGET_FAILED ctx={"errcode":40003}'])
  })
})

// 二进制形态 fetch 桩（getKfMedia 注入用·content-type 驱动成功/失败分支）
function binFetch(kind: 'binary' | 'json', payload: Buffer | Record<string, unknown>) {
  const calls: string[] = []
  const impl = async (url: string) => {
    calls.push(String(url))
    if (kind === 'binary') {
      const b = payload as Buffer
      return {
        headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? 'image/jpeg' : null) },
        json: async () => ({}),
        arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
      }
    }
    return {
      headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? 'application/json; charset=utf-8' : null) },
      json: async () => payload,
      arrayBuffer: async () => new ArrayBuffer(0),
    }
  }
  return { calls, impl }
}

describe('getKfMedia（content-type 判定成功/失败·过期语义）', () => {
  it('大白话：URL 带对 media_id；二进制回包=成功，字节一个不差', async () => {
    const { calls, impl } = binFetch('binary', Buffer.from('JPEG-BYTES-0123'))
    const r = await getKfMedia('T', 'm-1', impl as any)
    expect(calls[0]).toBe('https://qyapi.weixin.qq.com/cgi-bin/kf/media/get?access_token=T&media_id=m-1')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.buffer.toString('utf8')).toBe('JPEG-BYTES-0123')
      expect(r.buffer.length).toBe(15)
    }
    expect(alertLines()).toEqual([])
  })

  it('大白话：JSON 回包=失败，40007（不合法的媒体文件id）按过期语义带原始 errcode，告警逐字留痕', async () => {
    const { impl } = binFetch('json', { errcode: 40007, errmsg: 'invalid media_id' })
    const r = await getKfMedia('T', 'm-1', impl as any)
    expect(r).toEqual({ ok: false, expired: true, errcode: 40007 })
    expect(alertLines()).toEqual(['[LD_ALERT] sev=security fn=wecom code=KF_MEDIA_GET_FAILED ctx={"errcode":40007}'])
  })

  it('大白话：JSON 回包=失败，非过期类错误码（如 45009 频控）expired:false 原样透出，不再统一误判过期（杀「恒 true」变异）', async () => {
    const { impl } = binFetch('json', { errcode: 45009, errmsg: 'api freq out of limit' })
    const r = await getKfMedia('T', 'm-1', impl as any)
    expect(r).toEqual({ ok: false, expired: false, errcode: 45009 })
  })
})

describe('kfSendText / kfFetchMedia（拓扑收编助手·参数→配置→token→平台调用链）', () => {
  // 统一 JSON 路由挂到 globalThis.fetch（这俩助手内部用 defaultFetch/defaultBinFetch）
  function stubFetchRouter(router: (url: string) => { json?: unknown; binary?: Buffer }) {
    const calls: string[] = []
    vi.stubGlobal('fetch', async (url: string, init?: { body?: string }) => {
      calls.push(String(url))
      const r = router(String(url))
      if (r.binary) {
        const b = r.binary
        return {
          headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? 'image/jpeg' : null) },
          json: async () => ({}),
          arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
          __body: init?.body,
        }
      }
      return {
        headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? 'application/json' : null) },
        json: async () => r.json ?? {},
        arrayBuffer: async () => new ArrayBuffer(0),
      }
    })
    return calls
  }
  const bodies: any[] = []
  function stubJson(router: (url: string, body?: any) => unknown) {
    bodies.length = 0
    const calls: string[] = []
    vi.stubGlobal('fetch', async (url: string, init?: { body?: string }) => {
      calls.push(String(url))
      const body = init?.body ? JSON.parse(init.body) : undefined
      bodies.push(body)
      return { json: async () => router(String(url), body) }
    })
    return calls
  }

  it('大白话：kfSendText 三参缺一即 BAD_ARGS（兜底串把空参洗成非空就漏了）——一个网络包不发', async () => {
    const calls = stubJson(() => ({}))
    expect(((await kfSendText({ externalUserId: '', openKfId: 'k', text: 'hi' })) as any).error).toBe('BAD_ARGS')
    expect(((await kfSendText({ externalUserId: 'e', openKfId: '', text: 'hi' })) as any).error).toBe('BAD_ARGS')
    expect(((await kfSendText({ externalUserId: 'e', openKfId: 'k', text: '' })) as any).error).toBe('BAD_ARGS')
    expect(calls.length).toBe(0)
  })

  it('大白话：只配了 corpId 没配 secret（|| 削成 && 的口子）→ KF_NOT_CONFIGURED，不去打 gettoken', async () => {
    control.seed('secureConfig', [{ _id: 'wxkf', corpId: 'corp-A' }])
    const calls = stubJson(() => ({}))
    expect(((await kfSendText({ externalUserId: 'e', openKfId: 'k', text: 'hi' })) as any).error).toBe('KF_NOT_CONFIGURED')
    expect(((await kfFetchMedia('m-1')) as any).error).toBe('KF_NOT_CONFIGURED')
    expect(calls.length).toBe(0)
  })

  it('大白话：配齐后 gettoken 的 URL 带真 corpid/corpsecret（掏空成 {} 必红）；send_msg 整包逐字 text 契约', async () => {
    control.seed('secureConfig', [{ _id: 'wxkf', corpId: 'corp-A', secret: 'sec-B' }])
    const calls = stubJson((url) => {
      if (url.includes('gettoken')) return { access_token: 'TOK9', expires_in: 7200 }
      if (url.includes('send_msg')) return { errcode: 0, msgid: 'm1' }
      return {}
    })
    const r: any = await kfSendText({ externalUserId: 'eu1', openKfId: 'kf1', text: '你好' })
    expect(calls[0]).toBe('https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=corp-A&corpsecret=sec-B')
    expect(calls[1]).toBe('https://qyapi.weixin.qq.com/cgi-bin/kf/send_msg?access_token=TOK9')
    expect(bodies[1]).toEqual({ touser: 'eu1', open_kfid: 'kf1', msgtype: 'text', text: { content: '你好' } })
    expect(r).toEqual({ ok: true, sent: true, errcode: 0, msgid: 'm1' })
  })

  it('大白话：send_msg 回包是 null（可选链削成硬取就炸）→ 不炸，归一 sent:true/errcode:0/msgid 空串', async () => {
    control.seed('secureConfig', [{ _id: 'wxkf', corpId: 'corp-A', secret: 'sec-B' }])
    stubJson((url) => (url.includes('gettoken') ? { access_token: 'TOK9', expires_in: 7200 } : null))
    expect(await kfSendText({ externalUserId: 'eu1', openKfId: 'kf1', text: 'hi' })).toEqual({ ok: true, sent: true, errcode: 0, msgid: '' })
  })

  it('大白话：gettoken 挂了 → TOKEN_FAILED 收口，绝不带着 undefined 令牌继续打 media 接口', async () => {
    control.seed('secureConfig', [{ _id: 'wxkf', corpId: 'corp-A', secret: 'sec-B' }])
    const calls = stubFetchRouter(() => ({ json: { errcode: 40001 } }))
    expect(((await kfFetchMedia('m-1')) as any).error).toBe('TOKEN_FAILED')
    expect(calls.some((u) => u.includes('media/get'))).toBe(false)
  })

  it('大白话：kfFetchMedia 空 id 拒；成功链——media URL 带真令牌与 media_id、直接回 Buffer 字节不差；JSON 失败按过期语义', async () => {
    expect(((await kfFetchMedia('')) as any).error).toBe('BAD_ARGS')
    control.seed('secureConfig', [{ _id: 'wxkf', corpId: 'corp-A', secret: 'sec-B' }])
    const calls = stubFetchRouter((url) => {
      if (url.includes('gettoken')) return { json: { access_token: 'TOK9', expires_in: 7200 } }
      return { binary: Buffer.from('IMG-BYTES') }
    })
    const r: any = await kfFetchMedia('m-1')
    expect(calls[0]).toBe('https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=corp-A&corpsecret=sec-B')
    expect(calls[1]).toBe('https://qyapi.weixin.qq.com/cgi-bin/kf/media/get?access_token=TOK9&media_id=m-1')
    expect(r.ok).toBe(true)
    expect(Buffer.isBuffer(r.buffer)).toBe(true)
    expect(r.buffer.toString('utf8')).toBe('IMG-BYTES')

    control.reset()
    control.seed('secureConfig', [{ _id: 'wxkf', corpId: 'corp-A', secret: 'sec-B' }])
    stubFetchRouter((url) => (url.includes('gettoken') ? { json: { access_token: 'TOK9', expires_in: 7200 } } : { json: { errcode: 40007 } }))
    expect(await kfFetchMedia('m-9')).toEqual({ ok: false, expired: true, errcode: 40007 })
  })
})

describe('无全局 fetch 的 node https 降级线（内存桩·真实企微对端属根因#8 真机域）', () => {
  it('大白话：JSON 线 GET——方法/主机/路径逐字、GET 不写 body；回包 JSON 解出令牌（降级线真的能用）', async () => {
    vi.stubGlobal('fetch', undefined)
    h.responseBody = '{"access_token":"HT","expires_in":7200}'
    expect(await getAccessToken({ corpid: 'c1', secret: 's1' })).toBe('HT')
    expect(h.calls.length).toBe(1)
    expect(h.calls[0].options.method).toBe('GET')
    expect(h.calls[0].options.hostname).toBe('qyapi.weixin.qq.com')
    expect(h.calls[0].options.path).toBe('/cgi-bin/gettoken?corpid=c1&corpsecret=s1')
    expect(h.calls[0].written).toBe('')
  })

  it('大白话：JSON 线 POST——写出的就是整包 JSON 请求体、带 JSON 头（if(false) 不写包必红）', async () => {
    vi.stubGlobal('fetch', undefined)
    h.responseBody = '{"next_cursor":"n1","has_more":1,"msg_list":[{"x":1}]}'
    const r = await syncMsg('T', { cursor: 'c0', token: 'st', openKfId: 'kf1', limit: 7 })
    expect(h.calls[0].options.method).toBe('POST')
    expect(h.calls[0].options.path).toBe('/cgi-bin/kf/sync_msg?access_token=T')
    expect(h.calls[0].options.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(h.calls[0].written)).toEqual({ cursor: 'c0', token: 'st', limit: 7, open_kfid: 'kf1' })
    expect(r).toEqual({ next_cursor: 'n1', has_more: 1, msg_list: [{ x: 1 }], errcode: undefined })
  })

  it('大白话：JSON 线回包空 body → 当 {} 处理（不是 JSON.parse 空串炸掉），走 GETTOKEN_FAILED 定型码', async () => {
    vi.stubGlobal('fetch', undefined)
    h.responseBody = ''
    await expect(getAccessToken({ corpid: 'c1', secret: 's1' })).rejects.toThrow('GETTOKEN_FAILED')
  })

  it('大白话：JSON 线 socket 报错 → reject 被消毒兜住，抛定型码 GETTOKEN_FETCH_FAIL（error 事件名被削=悬挂超时）', async () => {
    vi.stubGlobal('fetch', undefined)
    h.emitError = true
    await expect(getAccessToken({ corpid: 'c1', secret: 's1' })).rejects.toThrow('GETTOKEN_FETCH_FAIL')
  })

  it('大白话：二进制线——GET 到正确路径；多分片重组字节一个不差（拿整个 Buffer 池当结果必红）', async () => {
    vi.stubGlobal('fetch', undefined)
    h.responseHeaders = { 'content-type': 'image/jpeg' }
    h.responseChunks = [Buffer.from('IMG-'), Buffer.from('BYTES')]
    const r = await getKfMedia('T', 'm1')
    expect(h.calls[0].options.method).toBe('GET')
    expect(h.calls[0].options.hostname).toBe('qyapi.weixin.qq.com')
    expect(h.calls[0].options.path).toBe('/cgi-bin/kf/media/get?access_token=T&media_id=m1')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.buffer.length).toBe(9)
      expect(r.buffer.toString('utf8')).toBe('IMG-BYTES')
    }
  })

  it('大白话：二进制线 JSON 失败回包——content-type 判定驱动失败分支、errcode 原样带回（大小写/取头逻辑被动必红）', async () => {
    vi.stubGlobal('fetch', undefined)
    h.responseHeaders = { 'content-type': 'application/json; charset=utf-8' }
    h.responseBody = '{"errcode":40007,"errmsg":"media expired"}'
    expect(await getKfMedia('T', 'm1')).toEqual({ ok: false, expired: true, errcode: 40007 })
  })

  it('大白话：二进制线 JSON 失败但空 body → 当 {} 处理不炸；errcode 缺失非 40007，不误判过期（expired:false）', async () => {
    vi.stubGlobal('fetch', undefined)
    h.responseHeaders = { 'content-type': 'application/json' }
    h.responseBody = ''
    const r = await getKfMedia('T', 'm1')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.expired).toBe(false)
      expect(r.errcode).toBeUndefined()
    }
  })

  it('大白话：二进制线 socket 报错 → 原样 reject（调用方兜；error 事件名被削=悬挂超时）', async () => {
    vi.stubGlobal('fetch', undefined)
    h.emitError = true
    await expect(getKfMedia('T', 'm1')).rejects.toThrow('sock boom')
  })
})

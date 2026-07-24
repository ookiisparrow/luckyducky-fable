// 变异测试幸存者击杀（StrykerJS 对抗性检验·目标 kit/vod.ts 腾讯云 VOD 接缝·根因#12 单点收口）。
// 分诊后本文件只补 A 类真测试缺口（此前 vod 只被 course-chain-hardening 经 app 端点间接覆盖，
// 签名字节形状/告警口径/httpsFetch 兜底全程无人钉）：
//   ① Key 防盗链签名（signVodPlayUrl）：t/us/sign 三参独立复算验证——sign 用测试侧 md5(KEY+Dir+t+us)
//      重算比对（靠人#8「拿到≠用通」：不是断言「有个 sign 参数」，是哈希真能对上）；fail-closed 两口
//      （无 playKey / 坏 URL）钉精确 [LD_ALERT] 行（守卫 rw-vod-sign-fail-closed 的行为面）。
//   ② 上传签名（makeVodUploadSignature）：base64 解开成 HMAC(20B)+orig，HMAC-SHA1 测试侧真复算、
//      orig 查询串逐字符对（官方 266/9221 形状）；时间戳/有效期 2h/random 用假时钟+假随机钉死。
//   ③ 服务端 API（callVodApi）：固定时钟下 TC3-HMAC-SHA256 全链独立复算、Authorization 逐字符对；
//      出站 URL/方法/五头逐项对；语义错误（Response.Error）/无 Response/传输抛错三分支的返回值与
//      告警行分毫不差；httpsFetch 兜底（无全局 fetch）用 vi.mock('https') 假 socket 钉请求拼装/
//      分片重组/空体兜底/错误传播。
// ✅ 上述立案已修（2026-07-24 清账批·主脑亲核官方规范）：canonical 六段以 \n 相接 + CanonicalHeaders
//   自带尾 \n → host 行与 SignedHeaders 之间必有一个空行（官方文档示例串可证）。本文件 expectedTc3Auth
//   已同步按**规范形状**钉死——再有人把 vod.ts 的空行删回去，本测试逐字符比对即红。
//   终局证明仍需真机验签（靠人#8·随 VOD E2E 待办：控制台配置后真调 DescribeMediaInfos 看非 AuthFailure）。
// C 类（等价/接缝不可达·不立案）：L38 dir 初值（必被重赋或不被使用）；L62/L70 的
//   init?.→init. 与 'GET'→""、if(init?.body)→if(true)（callVodApi 唯一调用面恒传 init 且
//   method 恒 POST、body 恒非空）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createHash, createHmac } from 'crypto'
import cloud, { control } from 'wx-server-sdk'
import { signVodPlayUrl, makeVodUploadSignature, callVodApi } from '../src/kit/vod'

// —— vi.mock('https')：假 socket（只给「无全局 fetch 走 httpsFetch 兜底」的用例用·同 mutation-kill-wxpay 范式） ——
const H = vi.hoisted(() => {
  interface HttpsCall {
    options: { method?: string; hostname?: string; path?: string; headers?: Record<string, string> }
    writes: string[]
    onError?: (e: Error) => void
  }
  const state = { calls: [] as HttpsCall[], queue: [] as Array<{ chunks?: string[]; error?: Error }> }
  const request = (options: HttpsCall['options'], cb: (res: { on: (ev: string, fn: (chunk?: unknown) => void) => unknown }) => void) => {
    const rec: HttpsCall = { options, writes: [] }
    state.calls.push(rec)
    const req = {
      on(ev: string, fn: (e: Error) => void) {
        if (ev === 'error') rec.onError = fn
        return req
      },
      write(chunk: unknown) {
        rec.writes.push(String(chunk))
      },
      end() {
        const r = state.queue.shift() || { chunks: [''] }
        if (r.error) {
          const err = r.error
          queueMicrotask(() => rec.onError && rec.onError(err))
          return
        }
        const handlers: Record<string, Array<(chunk?: unknown) => void>> = {}
        const res = {
          on(ev: string, fn: (chunk?: unknown) => void) {
            ;(handlers[ev] = handlers[ev] || []).push(fn)
            return res
          },
        }
        queueMicrotask(() => {
          cb(res) // 真 https 语义：先回调注册 data/end 处理器，再吐分片
          for (const c of r.chunks || []) for (const f of handlers['data'] || []) f(c)
          for (const f of handlers['end'] || []) f()
        })
      },
    }
    return req
  }
  return { state, request }
})
vi.mock('https', () => ({ request: H.request, default: { request: H.request } }))

const db = cloud.database()
const md5hex = (s: string) => createHash('md5').update(s).digest('hex')
const sha256hex = (s: string) => createHash('sha256').update(s).digest('hex')
const hmac256 = (key: Buffer | string, s: string) => createHmac('sha256', key).update(s).digest()

// 固定时钟（TC3/上传签名/播放签名的时间参与哈希·钉死才能逐字符比对）
const FIXED = new Date('2026-07-24T03:04:05.000Z')
const TS = Math.floor(FIXED.getTime() / 1000)

const VOD_CFG = { _id: 'vod', secretId: 'AKIDtest', secretKey: 'sk-test-secret', playKey: 'pk-test-key', procedure: 'LuckyDuckyVod' }
const seedVod = (doc: Record<string, unknown> = VOD_CFG) => control.seed('secureConfig', [doc])

// TC3 Authorization 独立复算（按官方 signature-v3 规范钉死：CanonicalHeaders 与 SignedHeaders 之间有空行·2026-07-24 修）
function expectedTc3Auth(body: string): string {
  const date = new Date(TS * 1000).toISOString().slice(0, 10)
  const canonical = `POST\n/\n\ncontent-type:application/json; charset=utf-8\nhost:vod.tencentcloudapi.com\n\ncontent-type;host\n${sha256hex(body)}`
  const stringToSign = `TC3-HMAC-SHA256\n${TS}\n${date}/vod/tc3_request\n${sha256hex(canonical)}`
  const kSigning = hmac256(hmac256(hmac256(Buffer.from('TC3' + 'sk-test-secret'), date), 'vod'), 'tc3_request')
  return `TC3-HMAC-SHA256 Credential=AKIDtest/${date}/vod/tc3_request, SignedHeaders=content-type;host, Signature=${hmac256(kSigning, stringToSign).toString('hex')}`
}

// 注入式全局 fetch 脚本 mock（记录每次出站 url/init·按序吐响应）
type Scripted = { json: unknown } | { throws: unknown }
interface Recorded {
  url: string
  init?: { method?: string; headers?: Record<string, string>; body?: string }
}
function stubFetch(script: Scripted[]): Recorded[] {
  const calls: Recorded[] = []
  vi.stubGlobal('fetch', async (url: string, init?: Recorded['init']) => {
    calls.push({ url, init })
    const s = script.shift()
    if (!s) throw new Error('MOCK_SCRIPT_EXHAUSTED')
    if ('throws' in s) throw s.throws
    return { json: async () => s.json }
  })
  return calls
}

// [LD_ALERT] 行捕获（同 flow.test.ts 范式：alert 单出口＝console.error 一行，逐字符断言杀字面量变异）
let errLines: string[] = []
let spy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  control.reset()
  H.state.calls.length = 0
  H.state.queue.length = 0
  errLines = []
  spy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
    errLines.push(String(a[0]))
  })
})
afterEach(() => {
  spy.mockRestore()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('signVodPlayUrl（Key 防盗链签名·官方 266/14047·rw-vod-sign-fail-closed 行为面）', () => {
  it('大白话：黄金路径——t=过期时刻十六进制（now+6h）、us=8 位 hex、sign 用 md5(KEY+Dir+t+us) 独立复算对上、零告警', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(FIXED)
    seedVod()
    const raw = 'https://1250000000.vod2.myqcloud.com/dir1/dir2/v.f100240.mp4'
    const r = await signVodPlayUrl(db, raw)
    const tHex = (TS + 6 * 3600).toString(16) // 签名有效期 6h＝源码 SIGN_TTL_SEC 注释
    expect(String(r).startsWith(`${raw}?t=${tHex}&us=`)).toBe(true)
    const u = new URL(String(r))
    const us = u.searchParams.get('us') || ''
    expect(us).toMatch(/^[0-9a-f]{8}$/) // randomBytes(4).toString('hex')
    // Dir=pathname 到最后一个 / 为止；exper/rlimit 不用＝拼接处空串（源码注释口径）
    expect(u.searchParams.get('sign')).toBe(md5hex('pk-test-key' + '/dir1/dir2/' + tHex + us))
    expect(errLines).toEqual([])
  })

  it('大白话：rawUrl 为空——直接 null，零告警零动静（不当坏 URL 报警、不读库签名）', async () => {
    seedVod()
    const r = await signVodPlayUrl(db, '')
    expect(r).toBeNull()
    expect(errLines).toEqual([])
  })

  it('大白话：playKey 未配置——fail-closed 回 null + VOD_KEY_MISSING 告警行逐字符对（url 截 80）', async () => {
    const raw = 'https://vod.example.com/' + 'a'.repeat(90) // >80·钉 slice(0,80)
    const r = await signVodPlayUrl(db, raw)
    expect(r).toBeNull()
    expect(errLines).toEqual([`[LD_ALERT] sev=security fn=vod code=VOD_KEY_MISSING ctx={"url":"${raw.slice(0, 80)}"}`])
  })

  it('大白话：vodUrl 形态异常——同口径 fail-closed：null + VOD_BAD_URL 告警行逐字符对，绝不带着坏地址继续签', async () => {
    seedVod()
    const raw = 'not-a-url-' + 'b'.repeat(90)
    const r = await signVodPlayUrl(db, raw)
    expect(r).toBeNull() // catch 块被掏空（变异）会漏签出「裸地址+参数」——必须严格 null
    expect(errLines).toEqual([`[LD_ALERT] sev=security fn=vod code=VOD_BAD_URL ctx={"url":"${raw.slice(0, 80)}"}`])
  })
})

describe('makeVodUploadSignature（UGC 上传签名·官方 266/9221·base64(HMAC-SHA1+orig) 独立复算）', () => {
  it('大白话：固定时钟+固定随机——orig 查询串逐字符对（2h 有效期·procedure 随签下发）、HMAC-SHA1 测试侧真复算对上', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(FIXED)
    vi.spyOn(Math, 'random').mockReturnValue(0.5) // floor(0.5*0x7fffffff)=1073741823
    seedVod()
    const sig = await makeVodUploadSignature(db)
    const buf = Buffer.from(String(sig), 'base64')
    const mac = buf.subarray(0, 20) // SHA1 HMAC 定长 20 字节
    const orig = buf.subarray(20).toString()
    expect(orig).toBe(`secretId=AKIDtest&currentTimeStamp=${TS}&expireTime=${TS + 2 * 3600}&random=1073741823&procedure=LuckyDuckyVod`)
    expect(createHmac('sha1', 'sk-test-secret').update(orig).digest().equals(mac)).toBe(true)
  })

  it('大白话：procedure 未配置——orig 里绝不出现 procedure 键（空值也不下发·任务流不被空串顶掉）', async () => {
    seedVod({ _id: 'vod', secretId: 'AKIDtest', secretKey: 'sk-test-secret' })
    const sig = await makeVodUploadSignature(db)
    const orig = Buffer.from(String(sig), 'base64').subarray(20).toString()
    expect(orig.includes('procedure')).toBe(false)
  })

  it('大白话：secretId/secretKey 缺一即 null（预期过渡态·不告警）——只配 Id、只配 Key、全没配三态都关死', async () => {
    seedVod({ _id: 'vod', secretId: 'AKIDtest' })
    expect(await makeVodUploadSignature(db)).toBeNull()
    control.reset()
    seedVod({ _id: 'vod', secretKey: 'sk-test-secret' })
    expect(await makeVodUploadSignature(db)).toBeNull()
    control.reset()
    expect(await makeVodUploadSignature(db)).toBeNull()
    expect(errLines).toEqual([]) // 未配置是预期中的过渡态·不告警（源码注释口径）
  })
})

describe('callVodApi（TC3-HMAC-SHA256 手签·出站形状逐字钉 + 三分支失败口径）', () => {
  it('大白话：黄金路径——URL/方法/body/五个头逐项对、Authorization 用独立复算的 TC3 签名逐字符对、返回 Response、零告警', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(FIXED)
    seedVod()
    const calls = stubFetch([{ json: { Response: { RequestId: 'req-1', MediaInfoSet: [] } } }])
    const r = await callVodApi(db, 'DescribeMediaInfos', { FileIds: ['123'] })
    expect(r).toEqual({ RequestId: 'req-1', MediaInfoSet: [] })
    expect(calls.length).toBe(1)
    expect(calls[0].url).toBe('https://vod.tencentcloudapi.com')
    expect(calls[0].init?.method).toBe('POST')
    expect(calls[0].init?.body).toBe('{"FileIds":["123"]}')
    expect(calls[0].init?.headers).toEqual({
      'Content-Type': 'application/json; charset=utf-8',
      Host: 'vod.tencentcloudapi.com',
      Authorization: expectedTc3Auth('{"FileIds":["123"]}'),
      'X-TC-Action': 'DescribeMediaInfos',
      'X-TC-Version': '2018-07-17',
      'X-TC-Timestamp': String(TS),
    })
    expect(errLines).toEqual([]) // 成功路径零告警噪声
  })

  it('大白话：密钥未配置——null + VOD_NOT_CONFIGURED 告警行逐字符对、零出站（不带空密钥上路）', async () => {
    const calls = stubFetch([])
    const r = await callVodApi(db, 'DescribeMediaInfos', {})
    expect(r).toBeNull()
    expect(calls.length).toBe(0)
    expect(errLines).toEqual(['[LD_ALERT] sev=anomaly fn=vod code=VOD_NOT_CONFIGURED ctx={"action":"DescribeMediaInfos"}'])
  })

  it('大白话：只配 secretId 缺 secretKey——同样算未配置（缺一即关·不是两个都缺才关）', async () => {
    seedVod({ _id: 'vod', secretId: 'AKIDtest' })
    const calls = stubFetch([])
    const r = await callVodApi(db, 'DeleteMedia', {})
    expect(r).toBeNull()
    expect(calls.length).toBe(0)
    expect(errLines).toEqual(['[LD_ALERT] sev=anomaly fn=vod code=VOD_NOT_CONFIGURED ctx={"action":"DeleteMedia"}'])
  })

  it('大白话：语义错误（Response.Error）——Response 照样返回（调用方分辨·如 GC 把 ResourceNotFound 当删除成功），但告警行带 Error.Code 逐字符对', async () => {
    seedVod()
    stubFetch([{ json: { Response: { Error: { Code: 'ResourceNotFound.FileNotExist', Message: 'x' }, RequestId: 'req-2' } } }])
    const r = await callVodApi(db, 'DeleteMedia', { FileId: '9' })
    expect(r).toEqual({ Error: { Code: 'ResourceNotFound.FileNotExist', Message: 'x' }, RequestId: 'req-2' })
    expect(errLines).toEqual(['[LD_ALERT] sev=anomaly fn=vod code=VOD_API_ERROR ctx={"action":"DeleteMedia","code":"ResourceNotFound.FileNotExist"}'])
  })

  it('大白话：响应无 Response（空 json/null）——null + 告警 code=NO_RESPONSE 逐字符对', async () => {
    seedVod()
    stubFetch([{ json: {} }, { json: null }])
    expect(await callVodApi(db, 'DescribeMediaInfos', {})).toBeNull()
    expect(await callVodApi(db, 'DescribeMediaInfos', {})).toBeNull()
    expect(errLines).toEqual([
      '[LD_ALERT] sev=anomaly fn=vod code=VOD_API_ERROR ctx={"action":"DescribeMediaInfos","code":"NO_RESPONSE"}',
      '[LD_ALERT] sev=anomaly fn=vod code=VOD_API_ERROR ctx={"action":"DescribeMediaInfos","code":"NO_RESPONSE"}',
    ])
  })

  it('大白话：传输抛错——null + VOD_API_FAIL：Error 取 message 截 200、非 Error 原样 String（病根#14 动作类失败必留痕）', async () => {
    seedVod()
    const long = 'e'.repeat(250)
    stubFetch([{ throws: new Error(long) }, { throws: 'PLAIN_STRING_ERR' }])
    expect(await callVodApi(db, 'DescribeMediaInfos', {})).toBeNull()
    expect(await callVodApi(db, 'DescribeMediaInfos', {})).toBeNull()
    expect(errLines).toEqual([
      `[LD_ALERT] sev=anomaly fn=vod code=VOD_API_FAIL ctx={"action":"DescribeMediaInfos","error":"${'e'.repeat(200)}"}`,
      '[LD_ALERT] sev=anomaly fn=vod code=VOD_API_FAIL ctx={"action":"DescribeMediaInfos","error":"PLAIN_STRING_ERR"}',
    ])
  })
})

describe('httpsFetch 兜底出站（无全局 fetch·vi.mock("https") 假 socket·只锁请求拼装/分片重组/错误传播）', () => {
  it('大白话：运行时无全局 fetch → 走原生 https：method/host/path 逐项对、body 真写出、分片响应重组成整包 JSON', async () => {
    vi.stubGlobal('fetch', undefined) // 云函数运行时无全局 fetch 的形态
    seedVod()
    H.state.queue.push({ chunks: ['{"Response":{"Req', 'uestId":"r2"}}'] }) // 分 2 片·验 body 累积重组
    const r = await callVodApi(db, 'DescribeMediaInfos', { Ping: 1 })
    expect(r).toEqual({ RequestId: 'r2' })
    expect(H.state.calls.length).toBe(1)
    const c = H.state.calls[0]
    expect(c.options.method).toBe('POST')
    expect(c.options.hostname).toBe('vod.tencentcloudapi.com')
    expect(c.options.path).toBe('/') // pathname + search（无 query 时恰为 /）
    expect(c.options.headers?.['X-TC-Action']).toBe('DescribeMediaInfos')
    expect(c.writes).toEqual(['{"Ping":1}']) // body 必须真写进 socket
    expect(errLines).toEqual([])
  })

  it('大白话：空响应体——JSON.parse 兜 "{}" 不炸，落 NO_RESPONSE 口径（不是 VOD_API_FAIL）', async () => {
    vi.stubGlobal('fetch', undefined)
    seedVod()
    H.state.queue.push({ chunks: [] })
    const r = await callVodApi(db, 'DescribeMediaInfos', {})
    expect(r).toBeNull()
    expect(errLines).toEqual(['[LD_ALERT] sev=anomaly fn=vod code=VOD_API_ERROR ctx={"action":"DescribeMediaInfos","code":"NO_RESPONSE"}'])
  })

  it('大白话：socket 报错——reject 被捕成 VOD_API_FAIL 带错误原文（不悬挂不抛）', async () => {
    vi.stubGlobal('fetch', undefined)
    seedVod()
    H.state.queue.push({ error: new Error('sock-boom') })
    const r = await callVodApi(db, 'DescribeMediaInfos', {})
    expect(r).toBeNull()
    expect(errLines).toEqual(['[LD_ALERT] sev=anomaly fn=vod code=VOD_API_FAIL ctx={"action":"DescribeMediaInfos","error":"sock-boom"}'])
  })
})

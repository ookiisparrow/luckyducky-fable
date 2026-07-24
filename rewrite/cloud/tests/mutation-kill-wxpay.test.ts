// 变异测试幸存者击杀（StrykerJS 对抗性检验·目标 kit/wxpay.ts 商户 APIv3 接缝·根因#12 单点收口）。
// 分诊后本文件只补 A 类真测试缺口：
//   ① 纯函数面（normalizePem / wxpaySign / parseTradeBill）钉精确输出——期望值全部从 wxpay.ts
//      文件头注释与行内注释推导（消息形状 METHOD\nURL\nTS\nNONCE\nBODY\n、CSV 反引号/汇总区约定），不发明行为；
//   ② fetchTradeBill 注入 WxFetch mock（同 bill-reconcile.test.ts 范式）钉出站 URL/头/错误串逐字形状，
//      Authorization 用公钥真验签（靠人#8「拿到≠用通」——不是断言「有个头」，是签名真能验过）；
//   ③ httpsFetch 默认出站路径用 vi.mock('https') 假 socket 钉「请求拼装/分片重组/错误传播」——只锁本地
//      逻辑；真机对端可达性、微信侧验签是否收（服务商模式等）仍属根因#8 人工 spike 域，此处不冒充。
// 金额口径：BillRow.orderAmount/refundAmount 按 wxpay.ts 声明是「元」（下游 matchBillRows 经 toFen 转分比对），
// 本文件按解析器契约断言元值，不在此改口径。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { generateKeyPairSync, createVerify } from 'crypto'
import { normalizePem, wxpaySign, parseTradeBill, fetchTradeBill } from '../src/kit/wxpay'
import type { WxFetch, FetchBillOpts, BillRow } from '../src/kit/wxpay'

// —— vi.mock('https')：假 socket（只给「默认 fetchImpl」那三条用例用；注入 mock 的用例不经过这里） ——
const H = vi.hoisted(() => {
  interface HttpsCall {
    options: { method?: string; hostname?: string; path?: string; headers?: Record<string, string> }
    writes: string[]
    onError?: (e: Error) => void
    timeoutArm?: { ms: number; cb: () => void } // 超时防线布防记录（分诊缺口③修复锁定用）
  }
  interface ScriptedRes {
    statusCode?: number
    chunks?: string[]
    error?: Error
    hang?: boolean // 对端悬挂：不回包不报错，只有超时防线能救
  }
  const state = { calls: [] as HttpsCall[], queue: [] as ScriptedRes[] }
  const request = (
    options: HttpsCall['options'],
    cb: (res: { statusCode?: number; on: (ev: string, fn: (chunk?: unknown) => void) => unknown }) => void
  ) => {
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
      setTimeout(ms: number, cb: () => void) {
        rec.timeoutArm = { ms, cb }
        return req
      },
      destroy(e: Error) {
        rec.onError && rec.onError(e)
        return req
      },
      end() {
        const r = state.queue.shift() || { statusCode: 200, chunks: [''] }
        if (r.hang) return // 悬挂脚本：什么都不发生
        if (r.error) {
          const err = r.error
          queueMicrotask(() => rec.onError && rec.onError(err))
          return
        }
        const handlers: Record<string, Array<(chunk?: unknown) => void>> = {}
        const res = {
          statusCode: r.statusCode,
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

// 测试用真 RSA 密钥（同 bill-reconcile.test.ts：假串会全链塌、验签断言无从谈起·靠人#8）
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const PRIV = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()

// Authorization 头形状＝wxpay.ts L79 模板逐字；验签消息形状＝文件头注释 METHOD\nURL\nTS\nNONCE\nBODY\n
const AUTH_RE =
  /^WECHATPAY2-SHA256-RSA2048 mchid="([^"]*)",nonce_str="([^"]*)",signature="([^"]*)",timestamp="([^"]*)",serial_no="([^"]*)"$/

function parseAuth(auth: unknown) {
  const m = String(auth || '').match(AUTH_RE)
  return m ? { mchid: m[1], nonce: m[2], signature: m[3], timestamp: m[4], serial: m[5] } : null
}
function sigOk(auth: unknown, method: string, urlPath: string, body = ''): boolean {
  const p = parseAuth(auth)
  if (!p) return false
  const msg = `${method}\n${urlPath}\n${p.timestamp}\n${p.nonce}\n${body}\n`
  return createVerify('RSA-SHA256').update(msg).verify(publicKey, p.signature, 'base64')
}

const OPTS: FetchBillOpts = { date: '2026-07-15', mchid: '1113881793', serial: 'TESTSERIAL123', privateKey: PRIV }
const QUERY_PATH = '/v3/bill/tradebill?bill_date=2026-07-15&bill_type=ALL'
const DL_URL = 'https://api.mch.weixin.qq.com/v3/billdownload/file?token=t'
const DL_PATH = '/v3/billdownload/file?token=t'

// 微信交易账单 CSV（真实形状同 bill-reconcile.test.ts：表头 + 反引号数据行 + 汇总区）
const HEADER = '交易时间,公众账号ID,商户号,微信订单号,商户订单号,交易状态,订单金额,退款金额'
const ROW_OK = '`2026-07-15 10:00:00,`wxapp,`1113881793,`tx-1,`m1,`SUCCESS,`5.00,`0.00'
const ROW_REFUND = '`2026-07-15 11:00:00,`wxapp,`1113881793,`tx-2,`m2,`REFUND,`100.00,`20.00'
const CSV_FULL = [HEADER, ROW_OK, ROW_REFUND, '总交易单数,交易总金额,退款总金额', '`2,`105.00,`20.00'].join('\n')
const PARSED_OK: BillRow = {
  tradeTime: '2026-07-15 10:00:00',
  outTradeNo: 'm1',
  transactionId: 'tx-1',
  orderAmount: 5,
  refundAmount: 0,
  tradeState: 'SUCCESS',
}
const PARSED_REFUND: BillRow = {
  tradeTime: '2026-07-15 11:00:00',
  outTradeNo: 'm2',
  transactionId: 'tx-2',
  orderAmount: 100,
  refundAmount: 20,
  tradeState: 'REFUND',
}

// 注入式 WxFetch 脚本 mock（记录每次出站的 url/init·按序吐响应·可让 text() 拒绝或整体抛错）
type Scripted = { status: number; body: string } | { status: number; textRejects: true } | { throws: unknown }
interface Recorded {
  url: string
  init?: { method?: string; headers?: Record<string, string>; body?: string }
}
function mkFetch(script: Scripted[]) {
  const calls: Recorded[] = []
  const impl: WxFetch = async (url, init) => {
    calls.push({ url, init })
    const s = script.shift()
    if (!s) throw new Error('MOCK_SCRIPT_EXHAUSTED')
    if ('throws' in s) throw s.throws
    if ('textRejects' in s)
      return {
        status: s.status,
        text: async () => {
          throw new Error('READ_FAIL')
        },
      }
    return { status: s.status, text: async () => s.body }
  }
  return { calls, impl }
}

beforeEach(() => {
  H.state.calls.length = 0
  H.state.queue.length = 0
})

describe('normalizePem（PEM 还原·凭证经控制台/DB 塌行的修复器）', () => {
  it('大白话：字面 \\n 塌行 + 空格塌行 → 重建规范 PEM（64 列重折·只留 base64 字符）', () => {
    const body = 'A'.repeat(100)
    const raw = `-----BEGIN PRIVATE KEY-----\\n${body}\\n-----END PRIVATE KEY-----`
    expect(normalizePem(raw)).toBe(
      `-----BEGIN PRIVATE KEY-----\n${'A'.repeat(64)}\n${'A'.repeat(36)}\n-----END PRIVATE KEY-----\n`
    )
    // 换行全被塌成空格的形态：body 里的空格被 base64 过滤器清掉
    expect(normalizePem('-----BEGIN PRIVATE KEY----- AB CD -----END PRIVATE KEY-----')).toBe(
      '-----BEGIN PRIVATE KEY-----\nABCD\n-----END PRIVATE KEY-----\n'
    )
  })

  it('大白话：非 PEM 形态原样返回（只做字面 \\n 还原 + 首尾修剪·让上层报真错）', () => {
    expect(normalizePem('  a\\nb  ')).toBe('a\nb')
    expect(normalizePem('')).toBe('')
  })

  it('大白话：类型名尾随空格被修剪；空 body 不炸、结构保住', () => {
    expect(normalizePem('-----BEGIN RSA PRIVATE KEY -----\nabc\n-----END RSA PRIVATE KEY-----')).toBe(
      '-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----\n'
    )
    expect(normalizePem('-----BEGIN X-----\n\n-----END X-----')).toBe('-----BEGIN X-----\n\n-----END X-----\n')
  })
})

describe('wxpaySign（APIv3 Authorization 头·消息形状按文件头注释·公钥真验签）', () => {
  it('大白话：固定 ts/nonce → 头五字段逐字对 + 签名用公钥真验过（GET 空 body）', () => {
    const auth = wxpaySign({
      method: 'GET',
      urlPath: '/v3/x?a=1',
      body: '',
      mchid: '1113881793',
      serial: 'S1',
      privateKey: PRIV,
      timestamp: '1234567890',
      nonce: 'fixednonce01',
    })
    const p = parseAuth(auth)
    expect(p).not.toBeNull()
    expect(p?.mchid).toBe('1113881793')
    expect(p?.nonce).toBe('fixednonce01')
    expect(p?.timestamp).toBe('1234567890')
    expect(p?.serial).toBe('S1')
    expect(sigOk(auth, 'GET', '/v3/x?a=1', '')).toBe(true)
    // 消息形状敏感性：换个 urlPath 验签必失败（证明验的是真消息，不是恒真）
    expect(sigOk(auth, 'GET', '/v3/other', '')).toBe(false)
  })

  it('大白话：带 body 的 POST 消息形状也验通（BODY 段真参与签名）', () => {
    const auth = wxpaySign({
      method: 'POST',
      urlPath: '/v3/y',
      body: '{"k":1}',
      mchid: 'm',
      serial: 's',
      privateKey: PRIV,
      timestamp: '1234567890',
      nonce: 'n0',
    })
    expect(sigOk(auth, 'POST', '/v3/y', '{"k":1}')).toBe(true)
    expect(sigOk(auth, 'POST', '/v3/y', '')).toBe(false)
  })

  it('大白话：不传 ts/nonce → 默认当前秒 + 32 位 hex 随机 nonce·仍验通', () => {
    const before = Math.floor(Date.now() / 1000)
    const auth = wxpaySign({ method: 'GET', urlPath: '/v3/z', body: '', mchid: 'm', serial: 's', privateKey: PRIV })
    const after = Math.floor(Date.now() / 1000)
    const p = parseAuth(auth)
    expect(p).not.toBeNull()
    expect(p?.nonce).toMatch(/^[0-9a-f]{32}$/) // randomBytes(16).toString('hex')
    const ts = Number(p?.timestamp)
    expect(ts).toBeGreaterThanOrEqual(before)
    expect(ts).toBeLessThanOrEqual(after)
    expect(sigOk(auth, 'GET', '/v3/z', '')).toBe(true)
  })
})

describe('parseTradeBill（交易账单 CSV·反引号/汇总区/按表头名定位约定）', () => {
  it('大白话：真形状账单（含汇总区）→ 两行逐字段精确、汇总区一行不混入', () => {
    expect(parseTradeBill(CSV_FULL)).toEqual([PARSED_OK, PARSED_REFUND])
  })

  it('大白话：表头缺主键列（商户订单号/微信订单号任一）＝非预期格式 → 空数组', () => {
    const noOut = ['交易时间,微信订单号,订单金额', '`t,`tx-1,`5.00'].join('\n')
    const noTxn = ['交易时间,商户订单号,订单金额', '`t,`m1,`5.00'].join('\n')
    expect(parseTradeBill(noOut)).toEqual([])
    expect(parseTradeBill(noTxn)).toEqual([])
  })

  it('大白话：列序无关——每个关键列排第一列也照样按表头名对上', () => {
    const mk = (header: string, row: string) => parseTradeBill([header, row].join('\n'))
    expect(mk('商户订单号,微信订单号,交易时间,交易状态,订单金额,退款金额', '`m1,`tx-1,`t1,`SUCCESS,`5.00,`1.50')).toEqual([
      { tradeTime: 't1', outTradeNo: 'm1', transactionId: 'tx-1', orderAmount: 5, refundAmount: 1.5, tradeState: 'SUCCESS' },
    ])
    expect(mk('微信订单号,商户订单号', '`tx-2,`m2')).toEqual([
      { tradeTime: '', outTradeNo: 'm2', transactionId: 'tx-2', orderAmount: 0, refundAmount: 0, tradeState: '' },
    ])
    expect(mk('订单金额,微信订单号,商户订单号', '`5.00,`tx-3,`m3')).toEqual([
      { tradeTime: '', outTradeNo: 'm3', transactionId: 'tx-3', orderAmount: 5, refundAmount: 0, tradeState: '' },
    ])
    expect(mk('退款金额,微信订单号,商户订单号', '`20.00,`tx-4,`m4')).toEqual([
      { tradeTime: '', outTradeNo: 'm4', transactionId: 'tx-4', orderAmount: 0, refundAmount: 20, tradeState: '' },
    ])
    expect(mk('交易状态,微信订单号,商户订单号', '`SUCCESS,`tx-5,`m5')).toEqual([
      { tradeTime: '', outTradeNo: 'm5', transactionId: 'tx-5', orderAmount: 0, refundAmount: 0, tradeState: 'SUCCESS' },
    ])
  })

  it('大白话：缺可选列（时间/金额/退款/状态）→ 字段取默认（空串/0）不炸', () => {
    expect(parseTradeBill(['微信订单号,商户订单号', '`tx-1,`m1'].join('\n'))).toEqual([
      { tradeTime: '', outTradeNo: 'm1', transactionId: 'tx-1', orderAmount: 0, refundAmount: 0, tradeState: '' },
    ])
  })

  it('大白话：脏字段——空字段/尾随空格/字段内嵌反引号只剥前导那一个', () => {
    const csv = [
      '微信订单号,交易时间,商户订单号,交易状态',
      '`tx-9,,no`tick,`SUCCESS  ', // 空时间字段（无反引号）·商户订单号内嵌反引号·状态尾随空格
      '`,`t2,,`FAIL', // 空微信订单号（仅反引号）·空商户订单号
    ].join('\n')
    expect(parseTradeBill(csv)).toEqual([
      { tradeTime: '', outTradeNo: 'no`tick', transactionId: 'tx-9', orderAmount: 0, refundAmount: 0, tradeState: 'SUCCESS' },
      { tradeTime: 't2', outTradeNo: '', transactionId: '', orderAmount: 0, refundAmount: 0, tradeState: 'FAIL' },
    ])
  })

  it('大白话：边界——空串/仅表头 → 空数组；表头+1 行 → 恰 1 行', () => {
    expect(parseTradeBill('')).toEqual([])
    expect(parseTradeBill(HEADER)).toEqual([])
    expect(parseTradeBill([HEADER, ROW_OK].join('\n'))).toEqual([PARSED_OK])
  })

  it('大白话：脏行——空白行/非反引号杂行跳过；反引号开头的表头行不被当数据', () => {
    const dirty = ['  ', HEADER, 'x,y,z', ROW_OK].join('\n')
    expect(parseTradeBill(dirty)).toEqual([PARSED_OK])
    // 表头行整行带反引号前缀（unq 对表头同样剥）——数据循环从第二行起，表头绝不解析成数据行
    const tickedHeader = ['`微信订单号,`商户订单号', '`tx-1,`m1'].join('\n')
    expect(parseTradeBill(tickedHeader)).toEqual([
      { tradeTime: '', outTradeNo: 'm1', transactionId: 'tx-1', orderAmount: 0, refundAmount: 0, tradeState: '' },
    ])
  })
})

describe('fetchTradeBill（注入 WxFetch mock·两段式出站形状逐字钉 + Authorization 真验签）', () => {
  it('大白话：黄金路径——查询/下载两跳 URL 逐字符对、三个头逐字对、两跳签名都真验过、行解析精确', async () => {
    const { calls, impl } = mkFetch([
      { status: 200, body: JSON.stringify({ download_url: DL_URL }) },
      { status: 200, body: CSV_FULL },
    ])
    const r = await fetchTradeBill(OPTS, impl)
    expect(r).toEqual({ ok: true, rows: [PARSED_OK, PARSED_REFUND] })
    expect(calls.length).toBe(2)
    // 第一跳：账单元数据查询（WXPAY_HOST + queryPath·被签内容须与请求一致）
    expect(calls[0].url).toBe('https://api.mch.weixin.qq.com' + QUERY_PATH)
    expect(calls[0].init?.method).toBe('GET')
    const h0 = calls[0].init?.headers || {}
    expect(h0.Accept).toBe('application/json')
    expect(h0['User-Agent']).toBe('luckyducky-recon/1.0')
    const p0 = parseAuth(h0.Authorization)
    expect(p0?.mchid).toBe('1113881793')
    expect(p0?.serial).toBe('TESTSERIAL123')
    expect(sigOk(h0.Authorization, 'GET', QUERY_PATH)).toBe(true)
    // 第二跳：下载 download_url·签名的 urlPath 必须是 download_url 的 pathname+search
    expect(calls[1].url).toBe(DL_URL)
    expect(calls[1].init?.method).toBe('GET')
    expect(sigOk(calls[1].init?.headers?.Authorization, 'GET', DL_PATH)).toBe(true)
  })

  it('大白话：带 billType + 服务商子商户号 → query 串逐字符对（sub_mchid 拼在最后）', async () => {
    const { calls, impl } = mkFetch([{ status: 200, body: '{}' }])
    const r = await fetchTradeBill({ ...OPTS, billType: 'SUCCESS', subMchId: 'SUB123' }, impl)
    expect(r).toEqual({ ok: false, error: 'NO_DOWNLOAD_URL' })
    expect(calls[0].url).toBe(
      'https://api.mch.weixin.qq.com/v3/bill/tradebill?bill_date=2026-07-15&bill_type=SUCCESS&sub_mchid=SUB123'
    )
  })

  it('大白话：查询非 200 → BILL_QUERY_{码}:{响应体前 300 字节}·体读不出就只留码（fail-soft 不抛）', async () => {
    const a = await fetchTradeBill(OPTS, mkFetch([{ status: 500, body: 'server oops' }]).impl)
    expect(a).toEqual({ ok: false, error: 'BILL_QUERY_500:server oops' })
    const long = 'x'.repeat(350)
    const b = await fetchTradeBill(OPTS, mkFetch([{ status: 500, body: long }]).impl)
    expect(b).toEqual({ ok: false, error: 'BILL_QUERY_500:' + 'x'.repeat(300) }) // 诊断串截 300·不整包回带
    const c = await fetchTradeBill(OPTS, mkFetch([{ status: 500, textRejects: true }]).impl)
    expect(c).toEqual({ ok: false, error: 'BILL_QUERY_500' })
  })

  it('大白话：查询 200 但空体/无 download_url → NO_DOWNLOAD_URL（不炸 JSON.parse）', async () => {
    expect(await fetchTradeBill(OPTS, mkFetch([{ status: 200, body: '' }]).impl)).toEqual({
      ok: false,
      error: 'NO_DOWNLOAD_URL',
    })
    expect(await fetchTradeBill(OPTS, mkFetch([{ status: 200, body: '{}' }]).impl)).toEqual({
      ok: false,
      error: 'NO_DOWNLOAD_URL',
    })
  })

  it('大白话：下载非 200 → BILL_DOWNLOAD_{码}:{前 300 字节}·体读不出只留码', async () => {
    const meta: Scripted = { status: 200, body: JSON.stringify({ download_url: DL_URL }) }
    const a = await fetchTradeBill(OPTS, mkFetch([meta, { status: 404, body: 'not found' }]).impl)
    expect(a).toEqual({ ok: false, error: 'BILL_DOWNLOAD_404:not found' })
    const long = 'y'.repeat(350)
    const b = await fetchTradeBill(OPTS, mkFetch([{ ...meta }, { status: 500, body: long }]).impl)
    expect(b).toEqual({ ok: false, error: 'BILL_DOWNLOAD_500:' + 'y'.repeat(300) })
    const c = await fetchTradeBill(OPTS, mkFetch([{ ...meta }, { status: 500, textRejects: true }]).impl)
    expect(c).toEqual({ ok: false, error: 'BILL_DOWNLOAD_500' })
  })

  it('大白话：fetch 抛错绝不反噬——错误细节按 cause.code→cause.message→code→message→unknown 逐级取', async () => {
    const cases: Array<[unknown, string]> = [
      [Object.assign(new Error('outer'), { cause: { code: 'ECONNRESET' } }), 'ECONNRESET'],
      [Object.assign(new Error('outer'), { cause: { message: 'tls boom' } }), 'tls boom'],
      [Object.assign(new Error('msg-here'), { code: 'EAI_AGAIN' }), 'EAI_AGAIN'],
      [new Error('plain boom'), 'plain boom'],
      [undefined, 'unknown'], // 连 error 对象都没有·兜底 unknown（且逐级取值链自身不许再炸）
    ]
    for (const [err, detail] of cases) {
      const r = await fetchTradeBill(OPTS, mkFetch([{ throws: err }]).impl)
      expect(r).toEqual({ ok: false, error: 'WXPAY_FETCH_FAIL:' + detail })
    }
  })
})

describe('httpsFetch 默认出站（vi.mock("https") 假 socket·只锁请求拼装/分片重组/错误传播）', () => {
  it('大白话：不注入 fetchImpl → 走原生 https：host/path/method/签名头逐项对、GET 不写 body、分片响应重组成整包', async () => {
    H.state.queue.push(
      { statusCode: 200, chunks: ['{"download_url":"', DL_URL, '"}'] }, // 元数据分 3 片·验 body 累积重组
      { statusCode: 200, chunks: [HEADER + '\n', ROW_OK] }
    )
    const r = await fetchTradeBill(OPTS)
    expect(r).toEqual({ ok: true, rows: [PARSED_OK] })
    expect(H.state.calls.length).toBe(2)
    const c0 = H.state.calls[0]
    expect(c0.options.method).toBe('GET')
    expect(c0.options.hostname).toBe('api.mch.weixin.qq.com')
    expect(c0.options.path).toBe(QUERY_PATH) // pathname + search 拼接
    expect(sigOk(c0.options.headers?.Authorization, 'GET', QUERY_PATH)).toBe(true)
    expect(c0.writes).toEqual([]) // GET 无 body·绝不 req.write
    expect(H.state.calls[1].options.path).toBe(DL_PATH)
  })

  it('大白话：响应没有 statusCode → 按 0 处理（进非 200 分支，不误当成功）', async () => {
    H.state.queue.push({ statusCode: undefined, chunks: ['nope'] })
    expect(await fetchTradeBill(OPTS)).toEqual({ ok: false, error: 'BILL_QUERY_0:nope' })
  })

  it('大白话：socket 报错 → reject 被 fail-soft 捕获成 WXPAY_FETCH_FAIL:{code}（不悬挂不抛）', async () => {
    H.state.queue.push({ error: Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }) })
    expect(await fetchTradeBill(OPTS)).toEqual({ ok: false, error: 'WXPAY_FETCH_FAIL:ECONNRESET' })
  })

  it('大白话：对端悬挂（不回包不报错）→ 超时防线（30 秒）掐掉·WXPAY_FETCH_FAIL:TIMEOUT，不挂死到云函数超时（2026-07-24 分诊缺口③锁定）', async () => {
    H.state.queue.push({ hang: true })
    const p = fetchTradeBill(OPTS)
    await new Promise((r) => setTimeout(r, 0)) // 让请求走到挂起点
    const rec = H.state.calls[H.state.calls.length - 1]
    expect(rec.timeoutArm).toBeDefined() // 超时防线必须已布防
    expect(rec.timeoutArm!.ms).toBe(30_000)
    rec.timeoutArm!.cb() // 模拟超时触发
    await expect(p).resolves.toEqual({ ok: false, error: 'WXPAY_FETCH_FAIL:TIMEOUT' })
  })
})

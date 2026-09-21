// 降熵测版 Jev：strip 门控 / 无 key 降级 / 一次一个 candidate。mock fetch，不打真网、不写真实 key。
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { getDb } from '../src/kit'
import {
  applyDecisionGate,
  entropyDecide,
  extractRequest,
  fallbackResponse,
  loadEntropyApiKey,
  validateRequest,
} from '../src/functions/ops/entropyDecide/decide'
import {
  ENTROPY_JEV_MODEL,
  ENTROPY_JEV_URL,
  entropyJevRequestBody,
  parseEntropyJevBody,
  REASON_TEXT,
} from '../src/functions/ops/entropyDecide/jev'

const ENV_KEYS = [
  'TYPESAFE_API_KEY',
  'ENTROPY_DECIDE_HIGH_MIN',
  'ENTROPY_DECIDE_NOUL_HIGH_MIN',
  'ENTROPY_DECIDE_TIMEOUT_MS',
  'JEV_CS_ROUTE',
] as const

beforeEach(() => {
  control.reset()
  for (const k of ENV_KEYS) delete process.env[k]
})
afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k]
})

const sampleReq = {
  schema_version: '0.1',
  intent: { statement: '清掉对当前意图没有贡献的死代码', source: 'user' },
  candidate: {
    id: 'dead-util-1',
    kind: 'dead_code',
    excerpt: 'export function unusedHelper() { return 1 }',
    hard_signals: [{ type: 'no_references', detail: 'grep 零命中' }],
  },
  constraints: { forbid_auto_delete: true, production_touch: false },
}

const jevOk = (over: Record<string, any> = {}) => ({
  model: 'jev-1.13.0',
  answers: {
    decision: { type: 'choice', choice: 'keep', confidence: 0.9, ...over.decision },
    high_confidence: { type: 'noul', noul: 0.92, ...over.high_confidence },
    reason_code: { type: 'choice', choice: 'keep_contributes', ...over.reason_code },
  },
})

describe('请求校验与请求体', () => {
  it('大白话：必须是 0.1 版本、有意图、一次只能塞一条候选', () => {
    expect(validateRequest(sampleReq).ok).toBe(true)
    expect(validateRequest({ ...sampleReq, schema_version: '0.2' })).toEqual({
      ok: false,
      detail: 'schema_version',
    })
    expect(validateRequest({ ...sampleReq, intent: { statement: '  ' } })).toEqual({
      ok: false,
      detail: 'intent.statement',
    })
    expect(validateRequest({ ...sampleReq, candidates: [sampleReq.candidate] })).toEqual({
      ok: false,
      detail: 'one_candidate',
    })
    const body = entropyJevRequestBody({
      intent: { statement: '清死代码' },
      candidate: { id: 'x', excerpt: 'fn', hard_signals: [] },
    })
    expect(body.model).toBe(ENTROPY_JEV_MODEL)
    expect(Object.keys(body.questions.decision.criteria)).toEqual(['keep', 'strip', 'suspect'])
    expect(body.questions.high_confidence.type).toBe('noul')
    expect(parseEntropyJevBody(jevOk())).toMatchObject({ choice: 'keep', choiceConfidence: 0.9, noulHigh: 0.92 })
    expect(parseEntropyJevBody({ model: 'jev-1.13.0', answers: {} })).toBe(null)
  })

  it('大白话：HTTP 外壳拆 JSON；callFunction 直接吃事件', () => {
    expect(extractRequest(sampleReq)).toEqual(sampleReq)
    expect(extractRequest({ httpMethod: 'POST', body: JSON.stringify(sampleReq) })).toEqual(sampleReq)
    expect(extractRequest({ httpMethod: 'POST', body: '{坏' })).toEqual({ __parse_error: true })
  })
})

describe('实现方门控', () => {
  it('大白话：模型说 strip 但把握不够——改写成 suspect，不进可删', () => {
    const lowConf = applyDecisionGate({
      choice: 'strip',
      choiceConfidence: 0.4,
      noulHigh: 0.95,
      hasHardSignals: true,
    })
    expect(lowConf).toEqual({ choice: 'suspect', confidence: 'low', noulHigh: true, rewritten: true })

    const noulLow = applyDecisionGate({
      choice: 'strip',
      choiceConfidence: 0.95,
      noulHigh: 0.2,
      hasHardSignals: true,
    })
    expect(noulLow.choice).toBe('suspect')
    expect(noulLow.confidence).toBe('high')
    expect(noulLow.noulHigh).toBe(false)
    expect(noulLow.rewritten).toBe(true)

    const noSignal = applyDecisionGate({
      choice: 'strip',
      choiceConfidence: 0.95,
      noulHigh: 0.95,
      hasHardSignals: false,
    })
    expect(noSignal.choice).toBe('suspect')
    expect(noSignal.rewritten).toBe(true)

    const okStrip = applyDecisionGate({
      choice: 'strip',
      choiceConfidence: 0.95,
      noulHigh: 0.95,
      hasHardSignals: true,
    })
    expect(okStrip).toEqual({ choice: 'strip', confidence: 'high', noulHigh: true, rewritten: false })
  })
})

describe('entropyDecide mock fetch', () => {
  it('大白话：一次只判一条；strip 低置信被改写成 suspect', async () => {
    process.env.TYPESAFE_API_KEY = 'test-key'
    const bodies: unknown[] = []
    const fetchFn = async (_url: string, init?: { body?: string }) => {
      bodies.push(init && init.body ? JSON.parse(init.body) : null)
      return {
        ok: true,
        status: 200,
        json: async () =>
          jevOk({
            decision: { choice: 'strip', confidence: 0.4 },
            high_confidence: { noul: 0.99 },
            reason_code: { choice: 'strip_no_contrib' },
          }),
      }
    }
    const r = await entropyDecide(sampleReq, { fetchFn })
    expect(r).toMatchObject({
      schema_version: '0.1',
      candidate_id: 'dead-util-1',
      choice: 'suspect',
      confidence: 'low',
      reason: REASON_TEXT.strip_gated,
      contributes_to_intent: null,
      noul: { high_confidence: true },
      fallback: null,
    })
    expect(bodies).toHaveLength(1)
    expect((bodies[0] as { questions: unknown }).questions).toBeTruthy()
  })

  it('大白话：没配密钥就全员 suspect，不打网、不抛 key', async () => {
    const calls: string[] = []
    const fetchFn = async (url: string) => {
      calls.push(String(url))
      throw new Error('must-not-fetch')
    }
    const r = await entropyDecide(sampleReq, { fetchFn })
    expect(calls).toEqual([])
    expect(r).toEqual(fallbackResponse('dead-util-1', 'no_key'))
  })

  it('大白话：超时和 5xx 也降级 suspect，日志里不许出现密钥', async () => {
    process.env.TYPESAFE_API_KEY = 'super-secret-key'
    const timeout = await entropyDecide(sampleReq, {
      fetchFn: async () => {
        const err = new Error('The operation was aborted due to timeout')
        err.name = 'TimeoutError'
        throw err
      },
    })
    expect(timeout).toEqual(fallbackResponse('dead-util-1', 'timeout'))

    const lines: string[] = []
    const orig = console.info
    console.info = (...a: unknown[]) => {
      lines.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '))
    }
    try {
      const boom = await entropyDecide(sampleReq, {
        fetchFn: async () => ({ ok: false, status: 503, json: async () => ({}) }),
      })
      expect(boom).toEqual(fallbackResponse('dead-util-1', 'error'))
    } finally {
      console.info = orig
    }
    const blob = lines.join('\n')
    expect(blob).toContain('[entropy-decide]')
    expect(blob).toContain('error')
    expect(blob).not.toContain('super-secret-key')
    expect(blob).not.toContain('Bearer')
    expect(blob).not.toContain('TYPESAFE')
  })

  it('大白话：库里的 apiKey 也能用；打的是官方 URL', async () => {
    control.seed('secureConfig', [{ _id: 'typesafe', apiKey: 'db-key' }])
    expect(await loadEntropyApiKey(getDb())).toBe('db-key')
    const urls: string[] = []
    await entropyDecide(sampleReq, {
      db: getDb(),
      fetchFn: async (url: string) => {
        urls.push(String(url))
        return { ok: true, status: 200, json: async () => jevOk() }
      },
    })
    expect(urls).toEqual([ENTROPY_JEV_URL])
  })
})

describe('与客服分流隔离', () => {
  it('大白话：降熵源码不碰客服闸，客服源码也不碰降熵入口', () => {
    const root = fileURLToPath(new URL('../src/functions', import.meta.url))
    const readTs = (dir: string): string => {
      let src = ''
      for (const n of readdirSync(dir)) {
        const p = join(dir, n)
        if (statSync(p).isDirectory()) src += readTs(p)
        else if (n.endsWith('.ts')) src += readFileSync(p, 'utf8')
      }
      return src
    }
    const strip = (s: string) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
    const ed = strip(readTs(join(root, 'ops/entropyDecide')))
    const kf = strip(readTs(join(root, 'cs/kfCallback')))
    expect(ed).not.toMatch(/\bJEV_CS_ROUTE\b/)
    expect(ed).not.toMatch(/\bkfCallback\b/)
    expect(kf).not.toMatch(/\bentropyDecide\b/)
  })
})

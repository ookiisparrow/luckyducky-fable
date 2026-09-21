/**
 * entropy_decide 核心（契约 v0.1）：一次一个 candidate，实现方门控 strip，失败降级 suspect。
 * 不写库、不删代码、不挂客服路径。
 */

import { COLLECTIONS } from '@ldrw/shared'
import {
  askEntropyJev,
  ENTROPY_CHOICES,
  REASON_TEXT,
  type EntropyChoice,
  type EntropyJevState,
  type JevFetch,
  type ReasonCode,
} from './jev'

export type EntropyConfidence = 'high' | 'low'
export type EntropyFallback = 'no_key' | 'timeout' | 'error'

export type EntropyDecideResponse = {
  schema_version: '0.1'
  candidate_id: string
  choice: EntropyChoice
  confidence: EntropyConfidence
  reason: string
  contributes_to_intent: boolean | null
  noul: { high_confidence: boolean }
  fallback: EntropyFallback | null
}

export type InvalidEntropyRequest = {
  ok: false
  error: 'INVALID_REQUEST'
  detail: string
}

const EXCERPT_MAX = 2048
const SCHEMA = '0.1'

export function highConfidenceMin(): number {
  const n = Number(process.env.ENTROPY_DECIDE_HIGH_MIN)
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : 0.7
}

export function noulHighMin(): number {
  const n = Number(process.env.ENTROPY_DECIDE_NOUL_HIGH_MIN)
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : 0.7
}

export function extractRequest(event: any): unknown {
  if (!event || typeof event !== 'object') return event
  if (event.httpMethod) {
    const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString() : event.body
    if (typeof raw === 'string' && raw) {
      try {
        return JSON.parse(raw)
      } catch {
        return { __parse_error: true }
      }
    }
    if (raw && typeof raw === 'object') return raw
    return {}
  }
  if (event.schema_version) return event
  if (event.data && typeof event.data === 'object' && event.data.schema_version) return event.data
  return event
}

type Normalized = {
  candidate_id: string
  hasHardSignals: boolean
  state: EntropyJevState
}

export function validateRequest(raw: unknown): { ok: true; value: Normalized } | { ok: false; detail: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, detail: 'body_not_object' }
  const r = raw as Record<string, unknown>
  if (r.__parse_error) return { ok: false, detail: 'json_parse' }
  if (r.schema_version !== SCHEMA) return { ok: false, detail: 'schema_version' }
  if ('candidates' in r) return { ok: false, detail: 'one_candidate' }
  const intent = r.intent && typeof r.intent === 'object' ? (r.intent as Record<string, unknown>) : null
  const statement = intent && typeof intent.statement === 'string' ? intent.statement.trim() : ''
  if (!intent || !statement) return { ok: false, detail: 'intent.statement' }
  const candidate = r.candidate && typeof r.candidate === 'object' ? (r.candidate as Record<string, unknown>) : null
  if (!candidate || Array.isArray(r.candidate)) return { ok: false, detail: 'candidate' }
  const signals = Array.isArray(candidate.hard_signals) ? candidate.hard_signals : []
  const excerptRaw = typeof candidate.excerpt === 'string' ? candidate.excerpt : ''
  const excerpt = excerptRaw.length > EXCERPT_MAX ? excerptRaw.slice(0, EXCERPT_MAX) : excerptRaw
  const id = typeof candidate.id === 'string' ? candidate.id : ''
  return {
    ok: true,
    value: {
      candidate_id: id,
      hasHardSignals: signals.length > 0,
      state: {
        intent: {
          statement,
          ...(typeof intent.source === 'string' ? { source: intent.source } : {}),
          ...(typeof intent.repo === 'string' ? { repo: intent.repo } : {}),
        },
        candidate: {
          id,
          ...(typeof candidate.kind === 'string' ? { kind: candidate.kind } : {}),
          ...(candidate.locator != null ? { locator: candidate.locator } : {}),
          excerpt,
          hard_signals: signals,
        },
        ...(r.constraints != null ? { constraints: r.constraints } : {}),
      },
    },
  }
}

export function contributesOf(choice: EntropyChoice): boolean | null {
  if (choice === 'keep') return true
  if (choice === 'strip') return false
  return null
}

export function applyDecisionGate(input: {
  choice: EntropyChoice
  choiceConfidence: number
  noulHigh: number
  hasHardSignals: boolean
}): { choice: EntropyChoice; confidence: EntropyConfidence; noulHigh: boolean; rewritten: boolean } {
  const confidence: EntropyConfidence = input.choiceConfidence >= highConfidenceMin() ? 'high' : 'low'
  const noulHigh = input.noulHigh >= noulHighMin()
  let choice = input.choice
  let rewritten = false
  // strip 仅当 confidence=high 且 noul.high_confidence 且有硬信号——实现方门控，不信模型松口
  if (choice === 'strip' && (confidence !== 'high' || !noulHigh || !input.hasHardSignals)) {
    choice = 'suspect'
    rewritten = true
  }
  if (!ENTROPY_CHOICES.includes(choice)) {
    choice = 'suspect'
    rewritten = true
  }
  return { choice, confidence, noulHigh, rewritten }
}

function reasonFor(
  choice: EntropyChoice,
  rewritten: boolean,
  reasonCode: ReasonCode | null,
  hasHardSignals: boolean
): string {
  if (rewritten) return REASON_TEXT.strip_gated
  if (reasonCode) return REASON_TEXT[reasonCode]
  if (choice === 'keep') return REASON_TEXT.keep_contributes
  if (choice === 'strip') return REASON_TEXT.strip_no_contrib
  return hasHardSignals ? REASON_TEXT.suspect_unclear : REASON_TEXT.suspect_no_signal
}

export function fallbackResponse(candidate_id: string, fallback: EntropyFallback): EntropyDecideResponse {
  return {
    schema_version: SCHEMA,
    candidate_id,
    choice: 'suspect',
    confidence: 'low',
    reason: REASON_TEXT.jev_unavailable,
    contributes_to_intent: null,
    noul: { high_confidence: false },
    fallback,
  }
}

/** 密钥只从运行时 env / secureConfig.typesafe 读。禁止写进日志、仓、PR。 */
export async function loadEntropyApiKey(db?: any): Promise<string> {
  const envKey = String(process.env.TYPESAFE_API_KEY || '')
  if (envKey) return envKey
  if (!db) return ''
  const got = await db
    .collection(COLLECTIONS.secureConfig)
    .doc('typesafe')
    .get()
    .catch(() => null)
  const d = (got && got.data) || {}
  if (typeof d.TYPESAFE_API_KEY === 'string' && d.TYPESAFE_API_KEY) return d.TYPESAFE_API_KEY
  if (typeof d.apiKey === 'string' && d.apiKey) return d.apiKey
  return ''
}

function logFallback(fallback: EntropyFallback, candidate_id: string): void {
  console.info('[entropy-decide]', { fallback, candidate_id })
}

export async function entropyDecide(
  raw: unknown,
  opts?: { db?: any; fetchFn?: JevFetch }
): Promise<EntropyDecideResponse | InvalidEntropyRequest> {
  const checked = validateRequest(raw)
  if (!checked.ok) return { ok: false, error: 'INVALID_REQUEST', detail: checked.detail }
  const { candidate_id, hasHardSignals, state } = checked.value
  const key = await loadEntropyApiKey(opts && opts.db)
  if (!key) {
    logFallback('no_key', candidate_id)
    return fallbackResponse(candidate_id, 'no_key')
  }
  const asked = await askEntropyJev(state, key, opts && opts.fetchFn)
  if (!asked.ok) {
    logFallback(asked.fallback, candidate_id)
    return fallbackResponse(candidate_id, asked.fallback)
  }
  const gated = applyDecisionGate({
    choice: asked.answers.choice,
    choiceConfidence: asked.answers.choiceConfidence,
    noulHigh: asked.answers.noulHigh,
    hasHardSignals,
  })
  return {
    schema_version: SCHEMA,
    candidate_id,
    choice: gated.choice,
    confidence: gated.confidence,
    reason: reasonFor(gated.choice, gated.rewritten, asked.answers.reasonCode, hasHardSignals),
    contributes_to_intent: contributesOf(gated.choice),
    noul: { high_confidence: gated.noulHigh },
    fallback: null,
  }
}

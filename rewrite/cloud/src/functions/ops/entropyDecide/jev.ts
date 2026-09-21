/**
 * 项目降熵专用 TypeSafe/Jev 请求面（测版）。
 * 与客服 kfCallback/jev.ts 隔离：自己的 questions、自己的 URL 常量，不读 JEV_CS_ROUTE。
 * 官方入口：POST https://api.typesafe.ai/v1/systemone（Bearer TYPESAFE_API_KEY）。
 */

export const ENTROPY_JEV_URL = 'https://api.typesafe.ai/v1/systemone'
export const ENTROPY_JEV_MODEL = 'jev-latest'

export const ENTROPY_CHOICES = ['keep', 'strip', 'suspect'] as const
export type EntropyChoice = (typeof ENTROPY_CHOICES)[number]

export const REASON_CODES = [
  'keep_contributes',
  'strip_no_contrib',
  'suspect_no_signal',
  'suspect_hidden',
  'suspect_fixture',
  'suspect_unclear',
] as const
export type ReasonCode = (typeof REASON_CODES)[number]

/** 短理由（契约 ≤40 字）。Jev 出 reason_code，实现方映射；门控/降级用固定模板。 */
export const REASON_TEXT: Record<ReasonCode | 'strip_gated' | 'jev_unavailable', string> = {
  keep_contributes: '相对意图仍有贡献',
  strip_no_contrib: '有硬信号且对意图无贡献',
  suspect_no_signal: '无硬信号，吃不准',
  suspect_hidden: '可能有隐藏用途',
  suspect_fixture: '可能是开关、合规或夹具',
  suspect_unclear: '证据不足，待确认',
  strip_gated: 'strip 未过置信门控',
  jev_unavailable: 'jev_unavailable',
}

export type EntropyJevAnswers = {
  model: string
  choice: EntropyChoice
  choiceConfidence: number
  noulHigh: number
  reasonCode: ReasonCode | null
}

export type EntropyJevState = {
  intent: { statement: string; source?: string; repo?: string }
  candidate: {
    id: string
    kind?: string
    locator?: unknown
    excerpt: string
    hard_signals: unknown[]
  }
  constraints?: unknown
}

export function entropyJevRequestBody(state: EntropyJevState) {
  return {
    model: ENTROPY_JEV_MODEL,
    state,
    questions: {
      decision: {
        type: 'choice',
        instructions: {
          question:
            'Given `intent.statement` and one candidate excerpt plus `hard_signals`, pick keep, strip, or suspect. strip only when hard_signals support that the candidate contributes nothing to the intent. Feature flags, compliance traces, or test fixtures → suspect. Do not strip because writing looks bad. If hard_signals is empty, prefer suspect.',
        },
        criteria: {
          keep: 'Still contributes to the stated intent (implementation, verification, or collaboration)',
          strip: 'Zero contribution to the intent, and hard_signals support that claim',
          suspect: 'Unclear, possible hidden use, or not enough evidence to delete',
        },
      },
      high_confidence: {
        type: 'noul',
        instructions:
          'Are you highly confident this keep/strip/suspect judgment is correct and supported by the given evidence?',
        criteria: {
          true: 'Hard signals and excerpt clearly support the decision relative to intent',
          false: 'Missing signals, possible hidden use, or the excerpt is insufficient',
        },
      },
      reason_code: {
        type: 'choice',
        instructions: 'Pick the shortest reason code that matches the decision. Do not invent a new code.',
        criteria: {
          keep_contributes: 'keep: still useful relative to intent',
          strip_no_contrib: 'strip: hard signals show no contribution',
          suspect_no_signal: 'suspect: hard_signals is empty',
          suspect_hidden: 'suspect: may have a hidden use (flag, compliance, fixture)',
          suspect_fixture: 'suspect: looks like a switch, compliance trace, or test fixture',
          suspect_unclear: 'suspect: evidence is not enough',
        },
      },
    },
  }
}

function choiceOf<T extends string>(body: any, key: string, allowed: readonly T[]): T | undefined {
  const raw = String((body && body.answers && body.answers[key] && body.answers[key].choice) || '')
  return allowed.includes(raw as T) ? (raw as T) : undefined
}

export function parseEntropyJevBody(body: any): EntropyJevAnswers | null {
  const model = String((body && body.model) || '')
  const choice = choiceOf(body, 'decision', ENTROPY_CHOICES)
  if (!model || !choice) return null
  const choiceConfidence = Number(body && body.answers && body.answers.decision && body.answers.decision.confidence)
  const noulHigh = Number(
    body && body.answers && body.answers.high_confidence && body.answers.high_confidence.noul
  )
  const reasonCode = choiceOf(body, 'reason_code', REASON_CODES) || null
  return {
    model,
    choice,
    choiceConfidence: Number.isFinite(choiceConfidence) ? choiceConfidence : 0,
    noulHigh: Number.isFinite(noulHigh) ? noulHigh : 0,
    reasonCode,
  }
}

export type JevFetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }
) => Promise<{ ok?: boolean; status?: number; json: () => Promise<any> }>

export type AskEntropyResult =
  | { ok: true; answers: EntropyJevAnswers }
  | { ok: false; fallback: 'timeout' | 'error' }

function isTimeout(err: unknown): boolean {
  const name = err && typeof err === 'object' && 'name' in err ? String((err as { name?: string }).name) : ''
  const msg = err instanceof Error ? err.message : String(err || '')
  return name === 'TimeoutError' || name === 'AbortError' || /timeout|timed out|aborted/i.test(msg)
}

export function entropyTimeoutMs(): number {
  const n = Number(process.env.ENTROPY_DECIDE_TIMEOUT_MS)
  return Number.isFinite(n) && n > 0 ? n : 8000
}

export async function askEntropyJev(
  state: EntropyJevState,
  apiKey: string,
  fetchFn?: JevFetch
): Promise<AskEntropyResult> {
  const doFetch: JevFetch | undefined = fetchFn || (globalThis as { fetch?: JevFetch }).fetch
  if (typeof doFetch !== 'function') return { ok: false, fallback: 'error' }
  const signal =
    typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(entropyTimeoutMs())
      : undefined
  try {
    const res = await doFetch(ENTROPY_JEV_URL, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(entropyJevRequestBody(state)),
      signal,
    })
    const status = typeof res.status === 'number' ? res.status : res.ok === false ? 500 : 200
    if (!res || res.ok === false || status >= 400) return { ok: false, fallback: 'error' }
    const answers = parseEntropyJevBody(await res.json())
    if (!answers) return { ok: false, fallback: 'error' }
    return { ok: true, answers }
  } catch (err) {
    return { ok: false, fallback: isTimeout(err) ? 'timeout' : 'error' }
  }
}

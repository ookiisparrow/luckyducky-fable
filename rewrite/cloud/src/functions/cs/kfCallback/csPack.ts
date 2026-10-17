/**
 * Config Pack lucky-ducky-2026-09-19 挂进测版运行时。
 * 构建只打进分流规则、forbidden_transitions、交接必填字段名；运行时不拉 GitHub。
 * Jev/原文 → triage_rules → 会话/交接（script id / lastScript）。
 * 包装破损对客正文只走 atomic-v1 assemblePackagingBubbles；Pack .txt 不发给顾客。
 * 状态怎么走只看本文件 ALLOWED；forbidden_transitions 只额外禁跳。
 */

import { COLLECTIONS } from '@ldrw/shared'
import type { JevResult } from './jev'
import PACK from './csPackAssets.generated.json'

type PackMachineState = 'new' | 'greet' | 'triage' | 'collect' | 'act' | 'resolve' | 'human'
export type PackHumanSub = 'queued' | 'connected' | 'failed' | ''

type PackSession = {
  state: PackMachineState
  humanSubstate: PackHumanSub
  intent: string
  stage: string
  slots: Record<string, string>
  collectRounds: number
  consecutiveUnknown: number
  lastScript: string
}

type PackTriageHit = {
  ruleId: string
  action: string
  scriptId: string
  intent: string
  stage: string
  confidence: number
  requiredSlots: string[]
  doNotAsk: string[]
}

type HandoffPayload = {
  intent: string
  filled_slots: Record<string, string>
  summary: string
  order_binding: Record<string, unknown> | null
  fail_reason: string
  epoch: number
}

type PackAssets = {
  pack_id: string
  state_machine: {
    forbidden_transitions: Array<{ from: string; to: string[] | string; unless?: string[] }>
  }
  triage_rules: {
    rules: Array<{
      id: string
      priority: number
      when: Record<string, unknown>
      action: string
      script: string
      required_slots?: string[]
      do_not_ask?: string[]
      comment?: string
    }>
    stage_keywords: Record<string, string[]>
  }
  handoff_payload: { required_fields: Array<{ name: string }> }
}

export const assets = PACK as PackAssets

export const PACK_REQUIRED_SCRIPTS = [
  'triage',
  'aftersale_packaging',
  'collect_severity_photo_hint',
  'collect_severity_desc',
  'collect_order_id',
  'human_queued',
  'human_connected',
  'human_failed',
] as const

const PACK_STATES = new Set<PackMachineState>(['new', 'greet', 'triage', 'collect', 'act', 'resolve', 'human'])

const ALLOWED: Record<PackMachineState, PackMachineState[]> = {
  new: ['greet'],
  greet: ['triage'],
  triage: ['collect', 'human', 'act'],
  collect: ['act', 'triage', 'human'],
  act: ['resolve', 'collect', 'human'],
  human: ['resolve'],
  resolve: [],
}

const PACKAGING_RE = /包装|摔坏|破损|压坏|压烂|磕坏|外箱|摔烂/

export function packSessionId(euid: string): string {
  return 'jevpack:' + euid
}

export function handoffDocId(euid: string, epoch: number): string {
  return 'handoff:' + euid + ':' + String(epoch)
}

export function looksPackagingDamage(text: string): boolean {
  return PACKAGING_RE.test(String(text || ''))
}

function mapNeed(need: string, text: string): { intent: string; stage: string; confidence: number } {
  if (looksPackagingDamage(text) || need === 'packaging') return { intent: 'packaging', stage: 'aftersale', confidence: 0.9 }
  if (need === 'missing') return { intent: 'wrong_or_missing', stage: 'aftersale', confidence: 0.8 }
  if (need === 'course') return { intent: 'product_course', stage: 'aftersale', confidence: 0.75 }
  if (need === 'logistics') return { intent: 'logistics', stage: 'insale', confidence: 0.8 }
  if (need === 'discount' || need === 'rush') return { intent: 'consult', stage: 'presale', confidence: 0.7 }
  const keys = assets.triage_rules.stage_keywords || {}
  for (const [stage, words] of Object.entries(keys)) {
    if ((words || []).some((w) => String(text || '').includes(w))) {
      if (stage === 'aftersale' && /发错|缺件|少了/.test(text))
        return { intent: 'wrong_or_missing', stage, confidence: 0.7 }
      if (stage === 'aftersale' && /质量/.test(text)) return { intent: 'quality', stage, confidence: 0.7 }
      if (stage === 'insale') return { intent: 'logistics', stage, confidence: 0.65 }
      if (stage === 'presale') return { intent: 'consult', stage, confidence: 0.65 }
    }
  }
  if (need === 'greeting' || need === 'other' || !need) return { intent: '', stage: 'unknown', confidence: 0.2 }
  return { intent: need, stage: 'unknown', confidence: 0.45 }
}

export function classifyPackIntent(
  ev: JevResult | null | undefined,
  text: string
): { intent: string; stage: string; confidence: number } {
  return mapNeed(String((ev && (ev.needStatus || ev.topic)) || ''), text)
}

function whenMatch(when: Record<string, unknown>, facts: Record<string, unknown>): boolean {
  return Object.entries(when || {}).every(([k, v]) => {
    if (k === 'user_asks_human' || k === 'sensitive_hit') return !!facts[k] === !!v
    if (k === 'severity' || k === 'intent' || k === 'stage') return String(facts[k] || '') === String(v)
    // 数值键用 !(a >= b) 而不是 a < b：比较量为 NaN 时两者结果相反，前者让该条件算满足
    if (k === 'confidence_lt') return !(Number(facts.confidence ?? 1) >= Number(v))
    if (k === 'consecutive_unknown_ge') return !(Number(facts.consecutive_unknown || 0) < Number(v))
    return true
  })
}

export function matchTriageRule(facts: {
  intent: string
  stage: string
  confidence: number
  severity?: string
  user_asks_human?: boolean
  sensitive_hit?: boolean
  consecutive_unknown?: number
}): PackTriageHit | null {
  const rules = [...(assets.triage_rules.rules || [])].sort((a, b) => a.priority - b.priority)
  for (const r of rules) {
    if (!whenMatch(r.when, facts)) continue
    const doNotAsk = r.do_not_ask ? [...r.do_not_ask] : facts.intent === 'packaging' ? ['order_id'] : []
    const requiredSlots = (r.required_slots || []).filter((s) => !doNotAsk.includes(s))
    return {
      ruleId: r.id,
      action: r.action,
      scriptId: r.script,
      intent: facts.intent,
      stage: facts.stage,
      confidence: facts.confidence,
      requiredSlots,
      doNotAsk,
    }
  }
  return null
}

export function resolvePackScriptId(ev: JevResult | null | undefined, text: string, userAsksHuman = false): PackTriageHit | null {
  const cls = classifyPackIntent(ev, text)
  return matchTriageRule({
    intent: cls.intent,
    stage: cls.stage,
    confidence: cls.confidence,
    severity: ev && ev.severity ? ev.severity : 'low',
    user_asks_human: userAsksHuman,
    consecutive_unknown: cls.intent ? 0 : 1,
  })
}

/** 包装破损主句：演练定稿只要合照，禁止订单号，禁止单独惊讶空壳。 */
export function resolvePackagingMainScript(ev: JevResult | null | undefined, text: string): string {
  if (!looksPackagingDamage(text) && String((ev && ev.needStatus) || '') !== 'packaging' && String((ev && ev.topic) || '') !== 'packaging')
    return ''
  return 'aftersale_packaging'
}

/** 实现铁律：packaging 不得向用户要订单号（规则残留 order_id 也滤掉）。 */
export function packagingMustNotAskOrderId(hit: PackTriageHit | null): boolean {
  if (!hit || hit.intent !== 'packaging') return true
  return !hit.requiredSlots.includes('order_id') && hit.doNotAsk.includes('order_id')
}

export function canTransition(from: PackMachineState, to: PackMachineState, opts?: { fail?: boolean }): boolean {
  if (!PACK_STATES.has(from) || !PACK_STATES.has(to) || (to === 'resolve' && opts?.fail)) return false
  for (const f of assets.state_machine.forbidden_transitions || []) {
    if (f.from !== from && f.from !== '*') continue
    const tos = Array.isArray(f.to) ? f.to : [f.to]
    if (tos.includes(to) && !f.unless?.length) return false
  }
  return ALLOWED[from].includes(to)
}

export function walkPackStates(from: PackMachineState, to: PackMachineState): PackMachineState[] | null {
  if (from === to) return [from]
  const q: PackMachineState[][] = [[from]]
  const seen = new Set<PackMachineState>([from])
  while (q.length) {
    const path = q.shift() as PackMachineState[]
    const cur = path[path.length - 1]
    for (const nxt of ALLOWED[cur] || []) {
      if (seen.has(nxt)) continue
      if (!canTransition(cur, nxt)) continue
      const nextPath = path.concat(nxt)
      if (nxt === to) return nextPath
      seen.add(nxt)
      q.push(nextPath)
    }
  }
  return null
}

export function emptyPackSession(): PackSession {
  return {
    state: 'new',
    humanSubstate: '',
    intent: '',
    stage: '',
    slots: {},
    collectRounds: 0,
    consecutiveUnknown: 0,
    lastScript: '',
  }
}

export function loadPackSession(raw: unknown): PackSession {
  const next = emptyPackSession()
  if (!raw || typeof raw !== 'object') return next
  const src = raw as Record<string, unknown>
  if (PACK_STATES.has(src.state as PackMachineState)) next.state = src.state as PackMachineState
  if (src.humanSubstate === 'queued' || src.humanSubstate === 'connected' || src.humanSubstate === 'failed')
    next.humanSubstate = src.humanSubstate
  next.intent = String(src.intent || '')
  next.stage = String(src.stage || '')
  next.slots = src.slots && typeof src.slots === 'object' ? { ...(src.slots as Record<string, string>) } : {}
  next.collectRounds = Number.isFinite(Number(src.collectRounds)) ? Number(src.collectRounds) : 0
  next.consecutiveUnknown = Number.isFinite(Number(src.consecutiveUnknown)) ? Number(src.consecutiveUnknown) : 0
  next.lastScript = String(src.lastScript || '')
  return next
}

export function persistablePack(state: PackSession): Record<string, unknown> {
  return { ...state, at: Date.now() }
}

export function advancePackSession(
  prev: PackSession,
  hit: PackTriageHit | null,
  opts?: { fail?: boolean; toHuman?: boolean }
): PackSession {
  const next = loadPackSession(prev)
  const act = hit ? hit.action : ''
  const want: PackMachineState = opts?.toHuman
    ? 'human'
    : act === 'human' || act === 'collect' || act === 'act'
      ? act
      : next.state === 'new'
        ? 'greet'
        : next.state
  const path = walkPackStates(next.state, want)
  // 失败不能假装结案：走不到目标或目标是结案时，能走到人工就退到人工排队
  if (opts?.fail && (!path || want === 'resolve')) {
    if (walkPackStates(next.state, 'human')) next.state = 'human'
    if (next.state === 'human') next.humanSubstate = 'queued'
    return next
  }
  if (!path) return next
  next.state = path[path.length - 1]
  if (hit) {
    next.intent = hit.intent || next.intent
    next.stage = hit.stage || next.stage
    next.lastScript = hit.scriptId
    if (hit.action === 'collect') next.collectRounds += 1
    if (hit.intent) next.slots.issue_type = hit.intent
    if (hit.stage) next.slots.stage = hit.stage
  }
  if (next.state === 'human') next.humanSubstate = next.humanSubstate || 'queued'
  if (!hit || !hit.intent) next.consecutiveUnknown += 1
  else next.consecutiveUnknown = 0
  return next
}

export function buildHandoffPayload(input: {
  intent?: string
  filledSlots?: Record<string, string>
  summary?: string
  orderBinding?: Record<string, unknown> | null
  failReason?: string
  epoch?: number
}): HandoffPayload {
  return {
    intent: String(input.intent || 'unknown'),
    filled_slots: input.filledSlots && typeof input.filledSlots === 'object' ? { ...input.filledSlots } : {},
    summary: String(input.summary || '').slice(0, 160),
    order_binding: input.orderBinding && typeof input.orderBinding === 'object' ? input.orderBinding : {},
    fail_reason: String(input.failReason || 'user_asks_human'),
    epoch: Number.isFinite(Number(input.epoch)) ? Math.max(0, Math.floor(Number(input.epoch))) : 0,
  }
}

export function handoffMissingFields(payload: HandoffPayload): string[] {
  const required = (assets.handoff_payload.required_fields || []).map((f) => f.name)
  const miss: string[] = []
  for (const name of required) {
    const v = (payload as unknown as Record<string, unknown>)[name]
    if (v === undefined || v === null) miss.push(name)
    else if (name === 'epoch' && !Number.isFinite(Number(v))) miss.push(name)
    else if (name === 'intent' && !String(v)) miss.push(name)
    else if (name === 'fail_reason' && !String(v)) miss.push(name)
    else if (name === 'summary' && typeof v !== 'string') miss.push(name)
    else if ((name === 'filled_slots' || name === 'order_binding') && typeof v !== 'object') miss.push(name)
  }
  return miss
}

export async function readPackSession(db: any, euid: string): Promise<PackSession> {
  const got = await db
    .collection(COLLECTIONS.kfState)
    .doc(packSessionId(euid))
    .get()
    .catch(() => null)
  return loadPackSession(got && got.data)
}

export async function writeHandoffStub(
  db: any,
  euid: string,
  input: {
    intent?: string
    filledSlots?: Record<string, string>
    summary?: string
    orderBinding?: Record<string, unknown> | null
    failReason?: string
    epoch?: number
  }
): Promise<HandoffPayload | null> {
  const payload = buildHandoffPayload(input)
  const miss = handoffMissingFields(payload)
  if (miss.length) return null
  const id = handoffDocId(euid, payload.epoch)
  try {
    const ref = db.collection(COLLECTIONS.kfState).doc(id)
    if (ref && typeof ref.set === 'function') {
      await ref.set({
        data: {
          ...payload,
          bot_closed_at: new Date().toISOString(),
          human_substate: 'queued',
        },
      })
    }
  } catch {
    /* fail-soft：交接审计不挡转人工 */
  }
  console.log('[kf] handoff', {
    intent: payload.intent,
    fail_reason: payload.fail_reason,
    epoch: payload.epoch,
    script: 'human_queued',
  })
  return payload
}

export async function readEpochForHandoff(db: any, euid: string): Promise<number> {
  const got = await db
    .collection(COLLECTIONS.kfState)
    .doc('jevsession:' + euid)
    .get()
    .catch(() => null)
  const n = Number(got && got.data && got.data.epoch)
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0
}

export async function loadAndAdvancePack(
  db: any,
  euid: string,
  ev: JevResult | null | undefined,
  text: string,
  opts?: { fail?: boolean; toHuman?: boolean; userAsksHuman?: boolean }
): Promise<{ session: PackSession; hit: PackTriageHit | null }> {
  const id = packSessionId(euid)
  let got: { data?: unknown } | null = null
  try {
    got = await db.collection(COLLECTIONS.kfState).doc(id).get()
  } catch {
    got = null
  }
  const prev = loadPackSession(got && got.data)
  const hit = resolvePackScriptId(ev, text, !!(opts && opts.userAsksHuman))
  const session = advancePackSession(prev, hit, opts)
  try {
    const ref = db.collection(COLLECTIONS.kfState).doc(id)
    if (ref && typeof ref.set === 'function') await ref.set({ data: persistablePack(session) })
  } catch {
    /* fail-soft：Pack 会话写失败不挡对客 */
  }
  return { session, hit }
}

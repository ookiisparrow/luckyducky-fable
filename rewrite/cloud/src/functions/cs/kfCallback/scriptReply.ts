/**
 * 闸开主流程 v0.0.2（含 bot 情绪表演）。图：cs-scripts/docs/10 + 老板定稿 mermaid。
 * 选句优先级 订单→情绪→严重程度→责任（勿反）。需求只给主题/犹豫/拍照。
 * 顾客情绪 ≠ bot 表演；道歉仅 responsibility=merchant。不编政策。
 * 会话记在 kfState `jevflow:<euid>`；data 不带 _id（真 sdk reject）。
 */

import { COLLECTIONS } from '@ldrw/shared'
import { alert } from '../../../kit'
import type {
  JevEmotionStatus,
  JevNeedStatus,
  JevOrderStatus,
  JevResponsibility,
  JevResult,
  JevSeverity,
} from './jev'
import { fillSlots, pickLine, rememberUsed, type ScriptPoolId } from './scriptPool'

export type ScriptNode =
  | 'greet'
  | 'greetIssue'
  | 'restate'
  | 'askMore'
  | 'photo'
  | 'promise'
  | 'askCoop'
  | 'answer'
  | 'askNext'
  | 'hesitate'
  | 'surprise'
  | 'awkward'
  | 'severity'
  | 'human'

export type Acting =
  | 'reassure'
  | 'empathy'
  | 'apology'
  | 'hesitate'
  | 'clarify'
  | 'steady'
  | 'light'
  | 'surprise'
  | 'awkward'

export type ActingCheckpoint = 'pick' | 'review' | 'promise' | 'coop' | 'solve' | ''

export type ScriptTopic =
  | 'logistics'
  | 'packaging'
  | 'missing'
  | 'course'
  | 'discount'
  | 'rush'
  | 'greeting'
  | 'other'

export type JevFlowState = {
  node: ScriptNode | ''
  topic: ScriptTopic | ''
  orderStatus: JevOrderStatus | ''
  acting: Acting | ''
  checkpoint: ActingCheckpoint
  greeted: boolean
  hesitated: boolean
  surprised: boolean
  photoAsked: boolean
  severitySaid: boolean
  restated: boolean
  promised: boolean
  solved: boolean
  coopCount: number
  used: string[]
}

export type JevRoute = {
  topic: ScriptTopic
  orderStatus: JevOrderStatus
  emotionStatus: JevEmotionStatus
  severity: JevSeverity
  responsibility: JevResponsibility
  needStatus: JevNeedStatus
  exceeds: boolean
}

const FLOW_KEYS = [
  'node',
  'topic',
  'orderStatus',
  'acting',
  'checkpoint',
  'greeted',
  'hesitated',
  'surprised',
  'photoAsked',
  'severitySaid',
  'restated',
  'promised',
  'solved',
  'coopCount',
  'used',
] as const

const TOPIC_NEEDS: readonly ScriptTopic[] = [
  'logistics',
  'packaging',
  'missing',
  'course',
  'discount',
  'rush',
  'greeting',
  'other',
]

function topicFromOrder(order: JevOrderStatus): ScriptTopic | '' {
  if (order === 'pre_order' || order === 'ordering') return 'discount'
  if (order === 'pre_ship') return 'rush'
  if (order === 'shipped') return 'logistics'
  if (order === 'unknown') return 'greeting'
  return ''
}

function topicOf(need: JevNeedStatus, order: JevOrderStatus, prev: ScriptTopic | ''): ScriptTopic {
  if ((TOPIC_NEEDS as readonly string[]).includes(need)) return need as ScriptTopic
  return prev || topicFromOrder(order) || 'other'
}

function isTopicNeed(need: JevNeedStatus): boolean {
  return (
    need === 'logistics' ||
    need === 'packaging' ||
    need === 'missing' ||
    need === 'course' ||
    need === 'discount' ||
    need === 'rush'
  )
}

function isNegative(emotion: JevEmotionStatus): boolean {
  return emotion === 'upset' || emotion === 'angry' || emotion === 'disappointed'
}

function needsCoop(r: JevRoute, state: JevFlowState): boolean {
  if (r.needStatus === 'photo_needed' && !state.photoAsked) return true
  if ((r.needStatus === 'missing' || r.needStatus === 'packaging' || r.needStatus === 'course') && !state.photoAsked)
    return true
  return false
}

function infoThin(r: JevRoute): boolean {
  if (r.needStatus === 'photo_needed') return true
  if (r.emotionStatus === 'confused') return true
  if (r.needStatus === 'other' || r.needStatus === 'greeting') return true
  return false
}

/** 只读 Jev 答案。不扫顾客原文猜题。 */
export function routeFromJev(state: JevFlowState, ev: JevResult): JevRoute {
  const orderStatus = ev.orderStatus || state.orderStatus || 'unknown'
  const emotionStatus = ev.emotionStatus || 'calm'
  const severity = ev.severity || 'low'
  const responsibility = ev.responsibility || 'n/a'
  const needStatus =
    ev.needStatus || (ev.topic && (TOPIC_NEEDS as readonly string[]).includes(ev.topic) ? ev.topic : 'other')
  const exceeds = needStatus === 'exceeds' || Number(ev.exceeds || 0) >= 0.55
  const topic = topicOf(needStatus, orderStatus, (ev.topic || state.topic || '') as ScriptTopic | '')
  return { topic, orderStatus, emotionStatus, severity, responsibility, needStatus, exceeds }
}

export function checkpointOf(node: ScriptNode): ActingCheckpoint {
  if (node === 'greet' || node === 'greetIssue' || node === 'surprise' || node === 'awkward' || node === 'hesitate')
    return 'pick'
  if (node === 'severity' || node === 'restate' || node === 'askMore') return 'review'
  if (node === 'promise') return 'promise'
  if (node === 'photo' || node === 'askCoop') return 'coop'
  if (node === 'answer' || node === 'askNext') return 'solve'
  return ''
}

function emotionToActing(emotion: JevEmotionStatus): Acting {
  if (emotion === 'angry' || emotion === 'upset' || emotion === 'anxious') return 'reassure'
  if (emotion === 'disappointed') return 'empathy'
  if (emotion === 'confused' || emotion === 'embarrassed') return 'clarify'
  if (emotion === 'hesitant') return 'hesitate'
  if (emotion === 'curious') return 'light'
  return 'steady'
}

/**
 * 顾客情绪 → bot 表演。顾客激动 ≠ 客服激动。
 * 道歉仅责任=我方。严重程度/责任在映射层叠加。
 */
export function actingOf(route: JevRoute, node: ScriptNode): Acting {
  if (node === 'surprise') return 'surprise'
  if (node === 'awkward') return 'awkward'
  if (node === 'hesitate') return 'hesitate'
  if (node === 'human') return 'steady'

  const cp = checkpointOf(node)
  const afterReview = cp === 'review' || cp === 'promise' || cp === 'coop' || cp === 'solve'
  if (route.responsibility === 'merchant' && afterReview) return 'apology'
  if (route.exceeds && afterReview) return 'hesitate'
  if (
    (route.responsibility === 'logistics' || route.responsibility === 'customer') &&
    (isNegative(route.emotionStatus) || route.emotionStatus === 'anxious')
  )
    return 'empathy'
  if (node === 'askNext' && !isNegative(route.emotionStatus)) return 'light'
  const base = emotionToActing(route.emotionStatus)
  if (route.severity === 'high' && (base === 'steady' || base === 'light') && afterReview) return 'reassure'
  return base
}

export function nextNode(state: JevFlowState, ev: JevResult, _text = ''): ScriptNode {
  const r = routeFromJev(state, ev)

  // 1. 订单（最高）：没开场先按订单/有没有事走开场
  if (!state.greeted) {
    if (r.needStatus === 'greeting' || (r.orderStatus === 'unknown' && !isTopicNeed(r.needStatus))) return 'greet'
    return 'greetIssue'
  }

  // 2. 情绪穿插
  if (isNegative(r.emotionStatus) && !state.surprised) return 'surprise'
  if (isNegative(r.emotionStatus) && state.surprised && state.node === 'surprise') return 'awkward'
  if (r.emotionStatus === 'embarrassed' && state.surprised && state.node === 'surprise') return 'awkward'

  // 3. 严重程度
  if (r.severity === 'high' && !state.severitySaid) return 'severity'

  // 4. 责任不单独占一句（表演复核里才允许道歉）；需求：犹豫 / 要图
  if (r.exceeds && !state.hesitated) return 'hesitate'
  if (r.needStatus === 'photo_needed' && !state.photoAsked && !state.restated) return 'photo'

  if (!state.restated) {
    if (infoThin(r)) return r.needStatus === 'photo_needed' ? 'photo' : 'askMore'
    return 'restate'
  }
  if (!state.promised) return 'promise'
  if (needsCoop(r, state)) {
    if (state.coopCount >= 3) return 'human'
    return r.needStatus === 'photo_needed' || r.needStatus === 'missing' || r.needStatus === 'packaging' || r.needStatus === 'course'
      ? 'photo'
      : 'askCoop'
  }
  if (!state.solved) return 'answer'
  return 'askNext'
}

function poolFor(node: ScriptNode, topic: ScriptTopic, ev: JevResult): ScriptPoolId {
  if (node === 'promise') return 'trySolve'
  if (node === 'askNext' || node === 'askCoop') return 'askMore'
  if (node === 'answer') {
    if (topic === 'discount') return 'discountConfirm'
    if (topic === 'rush') return 'rushConfirm'
    if (topic === 'logistics' && isNegative(ev.emotionStatus || 'calm')) return 'logisticsSlow'
    return 'answer'
  }
  if (node === 'photo') {
    if (topic === 'missing') return 'missingPhoto'
    if (topic === 'course') return 'coursePhoto'
    if (topic === 'packaging') return 'packPhoto'
    return 'photo'
  }
  if (node === 'restate' && topic === 'discount') return 'discountRestate'
  return node === 'human' ? 'askMore' : (node as ScriptPoolId)
}

function actingPool(acting: Acting): ScriptPoolId {
  if (acting === 'reassure') return 'reassure'
  if (acting === 'empathy') return 'empathy'
  if (acting === 'apology') return 'apology'
  if (acting === 'hesitate') return 'hesitate'
  if (acting === 'clarify') return 'clarify'
  if (acting === 'surprise') return 'surprise'
  if (acting === 'awkward') return 'awkward'
  if (acting === 'light') return 'askMore'
  return 'ack'
}

export function compressNeed(text: string): string {
  const t = String(text || '').replace(/\s+/g, '').slice(0, 24)
  return t || '您刚说的这件事'
}

export function emptyFlow(): JevFlowState {
  return {
    node: '',
    topic: '',
    orderStatus: '',
    acting: '',
    checkpoint: '',
    greeted: false,
    hesitated: false,
    surprised: false,
    photoAsked: false,
    severitySaid: false,
    restated: false,
    promised: false,
    solved: false,
    coopCount: 0,
    used: [],
  }
}

/** 读库：只收状态机字段，丢掉 _id / 杂字段。 */
export function loadFlow(raw: unknown): JevFlowState {
  const next = emptyFlow()
  if (!raw || typeof raw !== 'object') return next
  const src = raw as Record<string, unknown>
  for (const k of FLOW_KEYS) {
    if (k === 'used') continue
    if (src[k] !== undefined) (next as Record<string, unknown>)[k] = src[k]
  }
  next.used = Array.isArray(src.used) ? (src.used as string[]) : []
  next.coopCount = Number.isFinite(Number(src.coopCount)) ? Number(src.coopCount) : 0
  return next
}

/** 写库：显式字段，永不带 _id（真 sdk set data 含 _id 即拒）。 */
export function persistableFlow(state: JevFlowState): Record<string, unknown> {
  const out: Record<string, unknown> = { at: Date.now() }
  for (const k of FLOW_KEYS) out[k] = state[k]
  return out
}

export function applyNode(
  state: JevFlowState,
  node: ScriptNode,
  topic: ScriptTopic,
  orderStatus: JevOrderStatus,
  acting: Acting
): JevFlowState {
  const coopInc = node === 'askCoop' || (node === 'photo' && state.photoAsked) ? 1 : 0
  return {
    ...loadFlow(state),
    node,
    topic: topic || state.topic,
    orderStatus: orderStatus || state.orderStatus,
    acting,
    checkpoint: checkpointOf(node),
    greeted: state.greeted || node === 'greet' || node === 'greetIssue',
    hesitated: state.hesitated || node === 'hesitate',
    surprised: state.surprised || node === 'surprise',
    photoAsked: state.photoAsked || node === 'photo',
    severitySaid: state.severitySaid || node === 'severity',
    restated: state.restated || node === 'restate' || node === 'askMore',
    promised: state.promised || node === 'promise',
    solved: state.solved || node === 'answer',
    coopCount: state.coopCount + coopInc,
    used: state.used,
  }
}

function speak(
  node: ScriptNode,
  acting: Acting,
  topic: ScriptTopic,
  ev: JevResult,
  used: string[],
  slots: Record<string, string>,
  rand: () => number
): string {
  const body = fillSlots(pickLine(poolFor(node, topic, ev), used, undefined, rand), slots)
  if (node === 'human') return ''
  const actOnly = node === 'surprise' || node === 'awkward' || node === 'hesitate' || node === 'severity'
  if (actOnly) {
    const flavor = fillSlots(pickLine(actingPool(acting), used, undefined, rand), slots)
    return flavor || body
  }
  if (acting === 'steady' || acting === 'light') return body
  const flavor = fillSlots(pickLine(actingPool(acting), used, undefined, rand), slots)
  if (flavor && body && flavor !== body) return flavor + body
  return body || flavor
}

export function composeLine(
  state: JevFlowState,
  ev: JevResult,
  text: string,
  rand: () => number = Math.random
): { line: string; next: JevFlowState; node: ScriptNode; topic: ScriptTopic; acting: Acting; checkpoint: ActingCheckpoint } {
  const route = routeFromJev(state, ev)
  const node = nextNode({ ...state, topic: route.topic, orderStatus: route.orderStatus }, ev)
  const acting = actingOf(route, node)
  const slots = { 需求: compressNeed(text) }
  let line = speak(node, acting, route.topic, ev, state.used, slots, rand)
  if (!line && node !== 'human') line = fillSlots(pickLine('ack', state.used, undefined, rand), slots)
  const next = applyNode(state, node, route.topic, route.orderStatus, acting)
  next.used = rememberUsed(state.used, line)
  return { line, next, node, topic: route.topic, acting, checkpoint: checkpointOf(node) }
}

export async function composeScriptReply(
  db: any,
  euid: string,
  text: string,
  ev: JevResult
): Promise<{ text: string; node: ScriptNode; topic: ScriptTopic; acting: Acting; checkpoint: ActingCheckpoint } | null> {
  const id = 'jevflow:' + euid
  const got = await db
    .collection(COLLECTIONS.kfState)
    .doc(id)
    .get()
    .catch(() => null)
  const prev = loadFlow(got && got.data)
  const { line, next, node, topic, acting, checkpoint } = composeLine(prev, ev, text)
  if (!line && node !== 'human') return null
  let wrote = true
  await db
    .collection(COLLECTIONS.kfState)
    .doc(id)
    .set({ data: persistableFlow(next) })
    .catch(() => {
      wrote = false
    })
  if (!wrote) {
    alert('anomaly', 'kfCallback', 'JEVFLOW_WRITE_FAIL', { euid })
    return null
  }
  return { text: line, node, topic, acting, checkpoint }
}

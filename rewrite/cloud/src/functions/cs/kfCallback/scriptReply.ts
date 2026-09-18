/**
 * 闸开选句：优先级 订单→情绪→严重程度→责任（勿反）。
 * 需求只给主题池 / 犹豫 / 拍照，不抢前四步。不编政策。
 * 会话记在 kfState `jevflow:<euid>`。
 */

import { COLLECTIONS } from '@ldrw/shared'
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
  | 'ack'
  | 'restate'
  | 'hesitate'
  | 'trySolve'
  | 'answer'
  | 'askMore'
  | 'surprise'
  | 'awkward'
  | 'empathy'
  | 'reassure'
  | 'photo'
  | 'severity'
  | 'apology'

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
  greeted: boolean
  hesitated: boolean
  surprised: boolean
  photoAsked: boolean
  severitySaid: boolean
  apologized: boolean
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

/** 只读 Jev 答案。不扫顾客原文猜题。 */
export function routeFromJev(state: JevFlowState, ev: JevResult): JevRoute {
  const orderStatus = ev.orderStatus || state.orderStatus || 'unknown'
  const emotionStatus = ev.emotionStatus || 'calm'
  const severity = ev.severity || 'low'
  const responsibility = ev.responsibility || 'n/a'
  const needStatus = ev.needStatus || (ev.topic && (TOPIC_NEEDS as readonly string[]).includes(ev.topic) ? ev.topic : 'other')
  const exceeds = needStatus === 'exceeds' || Number(ev.exceeds || 0) >= 0.55
  const topic = topicOf(needStatus, orderStatus, (ev.topic || state.topic || '') as ScriptTopic | '')
  return { topic, orderStatus, emotionStatus, severity, responsibility, needStatus, exceeds }
}

export function nextNode(state: JevFlowState, ev: JevResult, _text = ''): ScriptNode {
  const r = routeFromJev(state, ev)

  // 1. 订单（最高）：没开场先按订单/有没有事走开场，情绪/严重/责任/需求都让路
  if (!state.greeted) {
    if (r.needStatus === 'greeting' || (r.orderStatus === 'unknown' && !isTopicNeed(r.needStatus))) return 'greet'
    return 'greetIssue'
  }

  // 2. 情绪
  if (isNegative(r.emotionStatus) && !state.surprised) return 'surprise'
  if (isNegative(r.emotionStatus) && state.surprised && state.node === 'surprise') return 'awkward'
  if (r.emotionStatus === 'embarrassed' && state.surprised) return 'awkward'
  if (
    r.emotionStatus === 'anxious' &&
    (state.node === 'greet' || state.node === 'greetIssue' || state.node === 'ack')
  )
    return 'empathy'

  // 3. 严重程度（情绪处理完或不需要处理才到这一步；有旗，不循环）
  if (r.severity === 'high' && !state.severitySaid) return 'severity'

  // 4. 责任（最后）：已确认我方才道歉；物流/顾客侧只同理（同理不设旗，仍钉在刚处理完的节点，防循环）
  if (r.responsibility === 'merchant' && !state.apologized) return 'apology'
  if (
    (r.responsibility === 'logistics' || r.responsibility === 'customer') &&
    (state.node === 'surprise' || state.node === 'awkward' || state.node === 'severity')
  )
    return 'empathy'

  // 需求：犹豫 / 拍照（不抢 1→4）
  if (r.exceeds && !state.hesitated) return 'hesitate'
  if (r.needStatus === 'photo_needed' && !state.photoAsked) return 'photo'

  switch (state.node) {
    case 'hesitate':
      return 'trySolve'
    case 'surprise':
    case 'awkward':
      return 'empathy'
    case 'severity':
    case 'apology':
      return r.needStatus === 'photo_needed' ? 'photo' : 'trySolve'
    case 'empathy':
      if (r.needStatus === 'photo_needed') return 'photo'
      return r.responsibility === 'merchant' ? 'reassure' : 'restate'
    case 'reassure':
      return r.needStatus === 'photo_needed' ? 'photo' : 'trySolve'
    case 'greet':
    case 'greetIssue':
      return 'ack'
    case 'ack':
      return 'restate'
    case 'restate':
      return 'trySolve'
    case 'photo':
      return 'trySolve'
    case 'trySolve':
      return r.needStatus === 'greeting' || r.needStatus === 'other' || r.needStatus === 'exceeds'
        ? 'askMore'
        : 'answer'
    default:
      return 'askMore'
  }
}

function poolFor(node: ScriptNode, topic: ScriptTopic, ev: JevResult): ScriptPoolId {
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
  if (node === 'empathy' && topic === 'rush') return 'rushEmpathy'
  return node
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
    greeted: false,
    hesitated: false,
    surprised: false,
    photoAsked: false,
    severitySaid: false,
    apologized: false,
    used: [],
  }
}

export function applyNode(
  state: JevFlowState,
  node: ScriptNode,
  topic: ScriptTopic,
  orderStatus: JevOrderStatus
): JevFlowState {
  return {
    ...state,
    node,
    topic: topic || state.topic,
    orderStatus: orderStatus || state.orderStatus,
    greeted: state.greeted || node === 'greet' || node === 'greetIssue',
    hesitated: state.hesitated || node === 'hesitate',
    surprised: state.surprised || node === 'surprise',
    photoAsked: state.photoAsked || node === 'photo',
    severitySaid: state.severitySaid || node === 'severity',
    apologized: state.apologized || node === 'apology',
  }
}

export function composeLine(
  state: JevFlowState,
  ev: JevResult,
  text: string,
  rand: () => number = Math.random
): { line: string; next: JevFlowState; node: ScriptNode; topic: ScriptTopic } {
  const route = routeFromJev(state, ev)
  const node = nextNode({ ...state, topic: route.topic, orderStatus: route.orderStatus }, ev)
  const slots = { 需求: compressNeed(text) }
  let line = fillSlots(pickLine(poolFor(node, route.topic, ev), state.used, undefined, rand), slots)
  if (!line) line = fillSlots(pickLine('ack', state.used, undefined, rand), slots)
  const next = applyNode(state, node, route.topic, route.orderStatus)
  next.used = rememberUsed(state.used, line)
  return { line, next, node, topic: route.topic }
}

export async function composeScriptReply(
  db: any,
  euid: string,
  text: string,
  ev: JevResult
): Promise<{ text: string; node: ScriptNode; topic: ScriptTopic } | null> {
  const id = 'jevflow:' + euid
  const got = await db
    .collection(COLLECTIONS.kfState)
    .doc(id)
    .get()
    .catch(() => null)
  const prev: JevFlowState = { ...emptyFlow(), ...((got && got.data) || {}) }
  if (!Array.isArray(prev.used)) prev.used = []
  const { line, next, node, topic } = composeLine(prev, ev, text)
  if (!line) return null
  await db
    .collection(COLLECTIONS.kfState)
    .doc(id)
    .set({ data: { ...next, at: Date.now() } })
    .catch(() => {})
  return { text: line, node, topic }
}

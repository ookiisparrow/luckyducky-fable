/**
 * 闸开时的话术状态机：只按 Jev 路由答案选节点/抽句（不发气泡、不编政策）。
 * 会话记在 kfState `jevflow:<euid>`。
 */

import { COLLECTIONS } from '@ldrw/shared'
import type { JevEmotionStatus, JevNeedStatus, JevOrderStatus, JevResult } from './jev'
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
  used: string[]
}

export type JevRoute = {
  topic: ScriptTopic
  orderStatus: JevOrderStatus
  emotionStatus: JevEmotionStatus
  needStatus: JevNeedStatus
  exceeds: boolean
}

function topicFromOrder(order: JevOrderStatus, need: JevNeedStatus): ScriptTopic | '' {
  if (need === 'unclear') return 'greeting'
  if (order === 'pre_order' || order === 'ordering') return 'discount'
  if (order === 'pre_ship') return 'rush'
  if (order === 'shipped') return 'logistics'
  if (order === 'aftersale') return 'other'
  return ''
}

/** 只读 Jev 答案（+会话里已记下的主题/订单态）。不扫顾客原文猜题。 */
export function routeFromJev(state: JevFlowState, ev: JevResult): JevRoute {
  const orderStatus = ev.orderStatus || state.orderStatus || 'unknown'
  const emotionStatus = ev.emotionStatus || 'calm'
  const needStatus = ev.needStatus || 'unclear'
  const exceeds = needStatus === 'exception' || Number(ev.exceeds || 0) >= 0.55
  const topic = (ev.topic ||
    topicFromOrder(orderStatus, needStatus) ||
    state.topic ||
    'other') as ScriptTopic
  return { topic, orderStatus, emotionStatus, needStatus, exceeds }
}

export function nextNode(state: JevFlowState, ev: JevResult, _text = ''): ScriptNode {
  const { topic, emotionStatus, needStatus, exceeds } = routeFromJev(state, ev)
  const negative = emotionStatus === 'upset' || emotionStatus === 'angry'

  if (exceeds && !state.hesitated) return 'hesitate'
  if (negative && !state.surprised) return 'surprise'
  if (negative && state.surprised && state.node === 'surprise') return 'awkward'
  if (!state.greeted) return needStatus === 'unclear' || topic === 'greeting' ? 'greet' : 'greetIssue'
  if (needStatus === 'photo_needed' && !state.photoAsked) return 'photo'
  if (
    emotionStatus === 'anxious' &&
    (state.node === 'greet' || state.node === 'greetIssue' || state.node === 'ack')
  )
    return 'empathy'

  switch (state.node) {
    case 'hesitate':
      return 'trySolve'
    case 'surprise':
    case 'awkward':
      return 'empathy'
    case 'empathy':
      if (needStatus === 'photo_needed') return 'photo'
      return needStatus === 'resolve' ? 'reassure' : 'restate'
    case 'reassure':
      return needStatus === 'photo_needed' ? 'photo' : 'trySolve'
    case 'greet':
    case 'greetIssue':
      return needStatus === 'info' ? 'restate' : 'ack'
    case 'ack':
      return 'restate'
    case 'restate':
      return 'trySolve'
    case 'photo':
      return 'trySolve'
    case 'trySolve':
      return needStatus === 'info' || needStatus === 'resolve' ? 'answer' : 'askMore'
    default:
      return 'askMore'
  }
}

function poolFor(node: ScriptNode, topic: ScriptTopic, ev: JevResult): ScriptPoolId {
  if (node === 'answer') {
    if (topic === 'discount') return 'discountConfirm'
    if (topic === 'rush') return 'rushConfirm'
    if (topic === 'logistics' && (ev.emotionStatus === 'upset' || ev.emotionStatus === 'angry'))
      return 'logisticsSlow'
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

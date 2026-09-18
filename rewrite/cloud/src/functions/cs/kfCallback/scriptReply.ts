/**
 * 闸开时的话术状态机：按节点取一句纯文本（不发气泡）。会话记在 kfState `jevflow:<euid>`。
 */

import { COLLECTIONS } from '@ldrw/shared'
import type { JevResult } from './jev'
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
  greeted: boolean
  hesitated: boolean
  surprised: boolean
  photoAsked: boolean
  used: string[]
}

const HELLO = /^(在吗|你好|您好|嗨|哈喽|hello|hi|在么|有人吗)[？?!~～。.\s]*$/i

const TOPIC_HINTS: { topic: ScriptTopic; words: string[] }[] = [
  { topic: 'logistics', words: ['物流', '快递', '包裹', '运单', '几天到', '还没到'] },
  { topic: 'packaging', words: ['包装', '箱子', '盒子烂', '破了', '压坏'] },
  { topic: 'missing', words: ['缺件', '少配件', '少材料', '没齐'] },
  { topic: 'course', words: ['进不去', '打不开课', '看不了课', '报错'] },
  { topic: 'discount', words: ['便宜', '打折', '优惠', '券', '减价'] },
  { topic: 'rush', words: ['加急', '催发', '快点发', '今天发'] },
]

export function inferTopic(text: string, department?: string): ScriptTopic {
  const t = String(text || '')
  for (const g of TOPIC_HINTS) if (g.words.some((w) => t.includes(w))) return g.topic
  if (HELLO.test(t.trim())) return 'greeting'
  if (department === 'technical') return 'course'
  if (department === 'sales') return 'discount'
  if (department === 'billing') return 'other'
  return t.trim().length <= 4 ? 'greeting' : 'other'
}

export function nextNode(state: JevFlowState, ev: JevResult, text: string): ScriptNode {
  const topic = (ev.topic || state.topic || inferTopic(text, ev.department)) as ScriptTopic
  const exceeds = Number(ev.exceeds || 0) >= 0.55
  const negative = Number(ev.negative || 0) >= 0.55
  const photoTopic = topic === 'packaging' || topic === 'missing' || topic === 'course'

  if (exceeds && !state.hesitated) return 'hesitate'
  if (negative && !state.surprised) return 'surprise'
  if (negative && state.surprised && state.node === 'surprise') return 'awkward'
  if (!state.greeted)
    return topic === 'greeting' || HELLO.test(String(text || '').trim()) ? 'greet' : 'greetIssue'

  if (
    photoTopic &&
    !state.photoAsked &&
    (state.node === 'ack' || state.node === 'restate' || state.node === 'empathy')
  )
    return 'photo'

  switch (state.node) {
    case 'hesitate':
      return 'trySolve'
    case 'surprise':
    case 'awkward':
      return 'empathy'
    case 'empathy':
      return photoTopic ? 'photo' : 'restate'
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
      return 'answer'
    default:
      return 'askMore'
  }
}

function poolFor(node: ScriptNode, topic: ScriptTopic, ev: JevResult): ScriptPoolId {
  if (node === 'answer') {
    if (topic === 'discount') return 'discountConfirm'
    if (topic === 'rush') return 'rushConfirm'
    if (topic === 'logistics' && Number(ev.negative || 0) >= 0.55) return 'logisticsSlow'
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

function safeConclusion(topic: ScriptTopic): string {
  if (topic === 'logistics') return '物流进度我先核对，核对完立刻回您'
  if (topic === 'discount') return '优惠规则我先确认，确认后回您，不跟您瞎说'
  if (topic === 'rush') return '能不能加急我先问排期，问完回您'
  if (topic === 'packaging') return '您先把包装和产品合照发我，我看好不好处理'
  if (topic === 'missing') return '您先拍张开箱图，我对完清单再处理'
  if (topic === 'course') return '您先发报错截图，我按图帮您排'
  return '我先帮您确认一下，确认后回您'
}

export function compressNeed(text: string): string {
  const t = String(text || '').replace(/\s+/g, '').slice(0, 24)
  return t || '您刚说的这件事'
}

export function emptyFlow(): JevFlowState {
  return {
    node: '',
    topic: '',
    greeted: false,
    hesitated: false,
    surprised: false,
    photoAsked: false,
    used: [],
  }
}

export function applyNode(state: JevFlowState, node: ScriptNode, topic: ScriptTopic): JevFlowState {
  return {
    ...state,
    node,
    topic: topic || state.topic,
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
  const topic = (ev.topic || state.topic || inferTopic(text, ev.department)) as ScriptTopic
  const node = nextNode({ ...state, topic }, ev, text)
  const slots = { 需求: compressNeed(text), 结论: safeConclusion(topic) }
  let line = fillSlots(pickLine(poolFor(node, topic, ev), state.used, undefined, rand), slots)
  if (!line) line = fillSlots(pickLine('ack', state.used, undefined, rand), slots)
  const next = applyNode(state, node, topic)
  next.used = rememberUsed(state.used, line)
  return { line, next, node, topic }
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

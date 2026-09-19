/**
 * 闸开主流程 v0.0.2（含 bot 情绪表演）。图：cs-scripts/docs/10 + 老板定稿 mermaid。
 * 选句优先级 订单→情绪→严重程度→责任（勿反）；可行动要图（needsPhoto）优先于惊讶/尴尬空壳。
 * 顾客情绪 ≠ bot 表演；道歉仅 responsibility=merchant。不编政策。
 * 会话记在 kfState `jevflow:<euid>`；data 不带 _id（真 sdk reject）。
 * Pack lucky-ducky-2026-09-19/scripts 已挂进运行时（T2）：Jev/原文 → triage_rules → Pack 主句。
 * 旧 cs-scripts 表演池只当 flavor；包装破损走 atomic-v1 门闩+优先级组装（有单 short：惊讶→道歉/共情→尽力→合照×3），不抽 Pack 池、不现编。
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
import {
  looksPackagingDamage,
  loadAndAdvancePack,
  readEpochForHandoff,
  resolvePackagingMainScript,
  writeHandoffStub,
} from './csPack'
import { assemblePackagingBubbles, stitchUtterance, type UtteranceStyle } from './csAtomic'

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
  | 'humanAsk'
  | 'humanAsk2'

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
  humanAsks: number
  used: string[]
  stitchText: string
  stitchAt: number
  utteranceStyle: UtteranceStyle | ''
}

export type JevRoute = {
  topic: ScriptTopic
  orderStatus: JevOrderStatus
  emotionStatus: JevEmotionStatus
  severity: JevSeverity
  responsibility: JevResponsibility
  needStatus: JevNeedStatus
  exceeds: boolean
  hasLogisticsFacts: boolean
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
  'humanAsks',
  'used',
  'stitchText',
  'stitchAt',
  'utteranceStyle',
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

function needsPhoto(need: JevNeedStatus | undefined): boolean {
  return need === 'photo_needed' || need === 'packaging' || need === 'missing' || need === 'course'
}

function hasLogisticsFacts(ev: JevResult): boolean {
  return !!(String(ev.location || '').trim() && String(ev.etaDays || '').trim())
}

function factSlots(ev: JevResult): Record<string, string> {
  if (!hasLogisticsFacts(ev)) return {}
  return { 地点: String(ev.location).trim(), 天数: String(ev.etaDays).trim() }
}

/** 没查到的事实不走「给回答」池（禁假【结论】/【地点】）。打折/加急有专题确认句。物流有实槽才报节点。 */
function canEmitAnswer(r: JevRoute): boolean {
  if (r.topic === 'discount' || r.topic === 'rush' || r.needStatus === 'discount' || r.needStatus === 'rush')
    return true
  return (r.topic === 'logistics' || r.needStatus === 'logistics') && r.hasLogisticsFacts
}

function flowForTopic(state: JevFlowState, r: JevRoute): JevFlowState {
  const switchTopic = !!(r.topic && state.topic !== r.topic && isTopicNeed(r.needStatus))
  const wrapupNewNeed =
    (state.node === 'askNext' || state.solved) && isTopicNeed(r.needStatus) && !canEmitAnswer(r)
  const greetingWrap = r.needStatus === 'greeting' && (state.node === 'askNext' || state.solved)
  if (switchTopic || wrapupNewNeed || greetingWrap) {
    return {
      ...state,
      restated: false,
      promised: false,
      solved: false,
      photoAsked: needsPhoto(r.needStatus) ? false : state.photoAsked,
    }
  }
  return state
}

/** 只留汉字/字母数字，剥零宽、标点、emoji。长业务句留给 Jev，不在这里猜题。 */
function foldHumanText(text: string): string {
  return String(text || '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF\u2060\u180E]/g, '')
    .replace(/[^\u4e00-\u9fffA-Za-z0-9]/g, '')
    .replace(/(谢谢|多谢|吧|哈|啊|呀|呢)+$/g, '')
}

/** 闸开短句要人工（边界逃生口）。长句中间提到「人工」不算。 */
export function wantsHuman(text: string): boolean {
  const t = foldHumanText(text)
  if (!t) return false
  if (/^(我)?(请?帮我?)?(想|要|麻烦)?(转接?|找|叫)?(一下)?人工(客服)?$/.test(t)) return true
  if (t.length <= 12 && /转人工|找人工|叫人工/.test(t)) return true
  return t.length <= 6 && t.includes('人工')
}

function looksLogistics(text: string): boolean {
  return /物流|快递|发货|运单|单号/.test(String(text || ''))
}

/** 短招呼、没具体事。长句里带「你好」不算。 */
export function looksGreeting(text: string): boolean {
  const t = foldHumanText(text)
  if (!t || t.length > 8) return false
  return /^(你好|您好|嗨嗨?|哈喽|在吗|在么|在不在|有人吗|hello|hi)$/i.test(t)
}

/** 卡在收尾或 Jev 把招呼/快递判薄时，用原文拉回专题。包装破损原文优先于招呼。 */
function evForScript(_state: JevFlowState, ev: JevResult, text: string): JevResult {
  if (looksPackagingDamage(text)) return { ...ev, needStatus: 'packaging', topic: 'packaging' }
  const need = ev.needStatus || 'other'
  if (looksLogistics(text) && !isTopicNeed(need)) return { ...ev, needStatus: 'logistics' }
  if (looksGreeting(text) && !isTopicNeed(need)) return { ...ev, needStatus: 'greeting' }
  return ev
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
  return { topic, orderStatus, emotionStatus, severity, responsibility, needStatus, exceeds, hasLogisticsFacts: hasLogisticsFacts(ev) }
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
  if (node === 'human' || node === 'humanAsk' || node === 'humanAsk2') return 'steady'

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

export function nextNode(state: JevFlowState, ev: JevResult, text = ''): ScriptNode {
  const r = routeFromJev(state, ev)
  const s = flowForTopic(state, r)
  if (r.needStatus === 'greeting') return 'greet'
  if (looksGreeting(text) && !isTopicNeed(r.needStatus)) return 'greet'
  const logisticsNoFacts =
    (r.needStatus === 'logistics' || r.topic === 'logistics') && !r.hasLogisticsFacts

  // 可行动要图优先于开场/惊讶/尴尬/严重度空壳，避免整轮只回「嗯？您慢慢说」。
  if (needsPhoto(r.needStatus) && !s.photoAsked) return 'photo'

  // 1. 订单（最高）：没开场先按订单/有没有事走开场
  if (!s.greeted) {
    if (r.orderStatus === 'unknown' && !isTopicNeed(r.needStatus)) return 'greet'
    return 'greetIssue'
  }

  // 2. 情绪穿插（无具体要图售后时才独占一轮）
  if (isNegative(r.emotionStatus) && !s.surprised) return 'surprise'
  if (isNegative(r.emotionStatus) && s.surprised && s.node === 'surprise') return 'awkward'
  if (r.emotionStatus === 'embarrassed' && s.surprised && s.node === 'surprise') return 'awkward'

  // 3. 严重程度
  if (r.severity === 'high' && !s.severitySaid) return 'severity'

  // 4. 责任不单独占一句（表演复核里才允许道歉）；需求：犹豫
  if (r.exceeds && !s.hesitated) return 'hesitate'

  if (!s.restated) {
    if (logisticsNoFacts) return 'promise'
    if (infoThin(r)) return r.needStatus === 'photo_needed' ? 'photo' : 'askMore'
    return 'restate'
  }
  if (!s.promised) return 'promise'
  if (needsCoop(r, s)) {
    if (s.coopCount >= 3) return 'human'
    return needsPhoto(r.needStatus) ? 'photo' : 'askCoop'
  }
  if (canEmitAnswer(r) && (!s.solved || r.hasLogisticsFacts)) return 'answer'
  if (logisticsNoFacts) return 'promise'
  return 'askNext'
}

function poolFor(node: ScriptNode, topic: ScriptTopic, ev: JevResult): ScriptPoolId {
  if (node === 'humanAsk') return 'humanAskWhat'
  if (node === 'humanAsk2') return 'humanSayDirect'
  if (node === 'promise') return 'trySolve'
  if (node === 'askNext' || node === 'askCoop') return 'askMore'
  if (node === 'greetIssue' && topic === 'logistics') return 'logisticsGreet'
  if (node === 'answer') {
    if (topic === 'discount') return 'discountConfirm'
    if (topic === 'rush') return 'rushConfirm'
    if (topic === 'logistics') return hasLogisticsFacts(ev) ? 'logisticsEta' : 'trySolve'
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
    humanAsks: 0,
    used: [],
    stitchText: '',
    stitchAt: 0,
    utteranceStyle: '',
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
  next.humanAsks = Number.isFinite(Number(src.humanAsks)) ? Number(src.humanAsks) : 0
  next.stitchText = String(src.stitchText || '')
  next.stitchAt = Number.isFinite(Number(src.stitchAt)) ? Number(src.stitchAt) : 0
  next.utteranceStyle = src.utteranceStyle === 'long' || src.utteranceStyle === 'short' ? src.utteranceStyle : ''
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

export type ComposeCtx = {
  hasRecentOrder?: boolean
  style?: UtteranceStyle
}

function packagingPieces(topic: ScriptTopic, ev: JevResult, text: string, rand: () => number, ctx?: ComposeCtx): string[] {
  const scriptId = resolvePackagingMainScript(ev, text)
  if (!scriptId && topic !== 'packaging' && ev.needStatus !== 'packaging') return []
  return assemblePackagingBubbles({
    text,
    hasRecentOrder: !ctx || ctx.hasRecentOrder !== false,
    style: (ctx && ctx.style) || 'short',
    severity: ev.severity,
    rand,
  })
}

function packMain(topic: ScriptTopic, ev: JevResult, text: string, _used: string[], rand: () => number): string {
  return packagingPieces(topic, ev, text, rand).join('\n')
}

function speak(
  node: ScriptNode,
  acting: Acting,
  topic: ScriptTopic,
  ev: JevResult,
  used: string[],
  slots: Record<string, string>,
  rand: () => number,
  text = ''
): string {
  const packBody = packMain(topic, ev, text, used, rand)
  // 包装破损走 atomic 门闩+优先级组装，不跟表演空壳粘、不抽旧 Pack
  if (packBody.includes('\n')) return packBody
  const body = packBody || fillSlots(pickLine(poolFor(node, topic, ev), used, undefined, rand), slots)
  if (node === 'human') return ''
  const actOnly = node === 'surprise' || node === 'awkward' || node === 'hesitate' || node === 'severity'
  if (actOnly) {
    const flavor = fillSlots(pickLine(actingPool(acting), used, undefined, rand), slots)
    // 惊讶/尴尬/严重度不得当唯一主回复：包装破损正文走 Pack，其它要图走旧拍照池
    if ((packBody || needsPhoto(ev.needStatus)) && node !== 'hesitate') {
      const photoBody = packBody || fillSlots(pickLine(poolFor('photo', topic, ev), used, undefined, rand), slots)
      if (photoBody) return flavor && flavor !== photoBody ? flavor + photoBody : photoBody
    }
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
  rand: () => number = Math.random,
  ctx?: ComposeCtx
): {
  line: string
  next: JevFlowState
  node: ScriptNode
  topic: ScriptTopic
  acting: Acting
  checkpoint: ActingCheckpoint
  pieces?: string[]
} {
  const useEv = evForScript(state, ev, text)
  const route = routeFromJev(state, useEv)
  if (wantsHuman(text)) {
    const n = state.humanAsks + 1
    const node: ScriptNode = n >= 3 ? 'human' : n === 1 ? 'humanAsk' : 'humanAsk2'
    const acting = actingOf(route, node)
    const line = node === 'human' ? '' : speak(node, acting, route.topic, ev, state.used, {}, rand, text)
    const next = applyNode(state, node, route.topic, route.orderStatus, acting)
    next.humanAsks = n
    next.used = rememberUsed(state.used, line)
    return { line, next, node, topic: route.topic, acting, checkpoint: checkpointOf(node) }
  }
  const base = flowForTopic(state, route)
  const node = nextNode({ ...base, topic: route.topic, orderStatus: route.orderStatus }, useEv, text)
  const acting = actingOf(route, node)
  const slots = { 需求: compressNeed(text), ...factSlots(useEv) }
  const atomic = packagingPieces(route.topic, useEv, text, rand, ctx)
  let line = atomic.length ? atomic.join('\n') : speak(node, acting, route.topic, useEv, base.used, slots, rand, text)
  if ((looksPackagingDamage(text) || route.topic === 'packaging') && /订单号/.test(line)) {
    line = assemblePackagingBubbles({
      text,
      hasRecentOrder: !ctx || ctx.hasRecentOrder !== false,
      style: (ctx && ctx.style) || 'short',
      severity: useEv.severity,
      rand,
    }).join('\n')
  }
  if (!line && node !== 'human') line = fillSlots(pickLine('ack', base.used, undefined, rand), slots)
  const next = applyNode(base, node, route.topic, route.orderStatus, acting)
  next.humanAsks = state.humanAsks
  next.used = rememberUsed(base.used, line)
  const pieces = atomic.length ? atomic : undefined
  return { line, next, node, topic: route.topic, acting, checkpoint: checkpointOf(node), pieces }
}

export async function composeScriptReply(
  db: any,
  euid: string,
  text: string,
  ev: JevResult,
  ctx?: ComposeCtx
): Promise<{
  text: string
  node: ScriptNode
  topic: ScriptTopic
  acting: Acting
  checkpoint: ActingCheckpoint
  humanAsks: number
  pieces?: string[]
} | null> {
  const id = 'jevflow:' + euid
  const got = await db
    .collection(COLLECTIONS.kfState)
    .doc(id)
    .get()
    .catch(() => null)
  const prev = loadFlow(got && got.data)
  const now = Date.now()
  const stitched = stitchUtterance(prev.stitchText, prev.stitchAt, text, now)
  const style: UtteranceStyle = prev.utteranceStyle === 'long' ? 'long' : 'short'
  const { line, next, node, topic, acting, checkpoint, pieces } = composeLine(prev, ev, stitched, Math.random, {
    hasRecentOrder: !ctx || ctx.hasRecentOrder !== false,
    style: (ctx && ctx.style) || style,
  })
  next.stitchText = stitched
  next.stitchAt = now
  next.utteranceStyle = (ctx && ctx.style) || style
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
  const pack = await loadAndAdvancePack(db, euid, ev, stitched, {
    toHuman: node === 'human',
    userAsksHuman: wantsHuman(stitched),
  })
  if (node === 'human') {
    const epoch = await readEpochForHandoff(db, euid)
    await writeHandoffStub(db, euid, {
      intent: pack.session.intent || topic || 'unknown',
      filledSlots: pack.session.slots,
      summary: String(stitched || '').slice(0, 160),
      failReason: wantsHuman(stitched) ? 'user_asks_human' : pack.hit && pack.hit.action === 'human' ? pack.hit.ruleId : 'collect_rounds_ge_3',
      epoch,
    })
  }
  return { text: line, node, topic, acting, checkpoint, humanAsks: next.humanAsks, pieces }
}

/**
 * 企微客服自由文本上的 TypeSafe/Jev 分流（体验/开发取证·正式默认关）。
 * 官方入口：POST https://api.typesafe.ai/v1/systemone（Bearer TYPESAFE_API_KEY）。
 * 密钥只从运行时 env / secureConfig.typesafe 读，禁止写进仓库或日志。
 */

import { COLLECTIONS } from '@ldrw/shared'

export const JEV_URL = 'https://api.typesafe.ai/v1/systemone'
export const JEV_MODEL = 'jev-latest'

type JevDepartment = 'billing' | 'technical' | 'sales'
export const JEV_TOPICS = [
  'logistics',
  'packaging',
  'missing',
  'course',
  'discount',
  'rush',
  'greeting',
  'other',
] as const
export type JevTopic = (typeof JEV_TOPICS)[number]
const JEV_ORDER = [
  'pre_order',
  'ordering',
  'pre_ship',
  'shipped',
  'delivered',
  'unknown',
] as const
export type JevOrderStatus = (typeof JEV_ORDER)[number]
const JEV_EMOTION = [
  'calm',
  'anxious',
  'upset',
  'angry',
  'disappointed',
  'confused',
  'embarrassed',
  'hesitant',
  'curious',
  'other',
] as const
export type JevEmotionStatus = (typeof JEV_EMOTION)[number]
const JEV_SEVERITY = ['low', 'medium', 'high'] as const
export type JevSeverity = (typeof JEV_SEVERITY)[number]
const JEV_RESP = ['customer', 'merchant', 'logistics', 'unclear', 'n/a'] as const
export type JevResponsibility = (typeof JEV_RESP)[number]
export const JEV_NEED = [
  'logistics',
  'packaging',
  'missing',
  'course',
  'discount',
  'rush',
  'exceeds',
  'photo_needed',
  'greeting',
  'other',
] as const
export type JevNeedStatus = (typeof JEV_NEED)[number]
export type JevResult = {
  model: string
  urgency: number
  department: JevDepartment
  topic?: JevTopic | null
  orderStatus?: JevOrderStatus
  emotionStatus?: JevEmotionStatus
  severity?: JevSeverity
  responsibility?: JevResponsibility
  needStatus?: JevNeedStatus
  exceeds?: number
  /** 真查到的物流节点。空=无实槽，禁止报 logisticsEta。 */
  location?: string
  etaDays?: string
}

type JevFetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }
) => Promise<{ ok?: boolean; status?: number; json: () => Promise<any> }>

/** 官方请求体：state=进线原文。选句优先级 订单→情绪→严重程度→责任；需求只给主题/犹豫/拍照。 */
export function jevRequestBody(state: string) {
  return {
    model: JEV_MODEL,
    state,
    questions: {
      urgency: { type: 'noul', instructions: 'Does this convey urgency?' },
      department: {
        type: 'choice',
        instructions: 'Which team should handle this?',
        criteria: {
          billing: 'Payments, invoicing, refunds',
          technical: 'Bugs, outages, integrations',
          sales: 'Pricing, upgrades, new accounts',
        },
      },
      orderStatus: {
        type: 'choice',
        instructions: 'Where is this order in its lifecycle? (highest routing priority)',
        criteria: {
          pre_order: 'Browsing or asking before placing an order',
          ordering: 'In the middle of placing an order',
          pre_ship: 'Paid, not shipped yet',
          shipped: 'Shipped, not received',
          delivered: 'Customer says they received it',
          unknown: 'Cannot tell / no order context yet',
        },
      },
      emotionStatus: {
        type: 'choice',
        instructions: 'What is the customer emotion right now? (second routing priority)',
        criteria: {
          calm: 'Neutral, polite, matter-of-fact',
          anxious: 'Worried, in a hurry, restless',
          upset: 'Unhappy, complaining',
          angry: 'Angry, accusing, harsh',
          disappointed: 'Let down, expected better',
          confused: 'Does not understand what happened',
          embarrassed: 'Awkward, uneasy about the situation',
          hesitant: 'Unsure, holding back',
          curious: 'Just asking, exploring',
          other: 'None of the above',
        },
      },
      severity: {
        type: 'choice',
        instructions: 'How serious is the situation? (third routing priority)',
        criteria: {
          low: 'Minor inconvenience, product still usable',
          medium: 'Meaningful delay or defect, needs follow-up',
          high: 'Unusable, missing core parts, or escalation',
        },
      },
      responsibility: {
        type: 'choice',
        instructions: 'Who is likely responsible? (last routing priority; do not invent fault)',
        criteria: {
          customer: 'Customer side / usage / expectation',
          merchant: 'Our packing, fulfillment, or product fault',
          logistics: 'Carrier / transit damage or delay',
          unclear: 'Not enough to assign fault',
          'n/a': 'No fault question in this turn',
        },
      },
      needStatus: {
        type: 'choice',
        instructions: 'What is the ask? Used for topic pools and hesitation/photo, not to override 1-4.',
        criteria: {
          logistics: 'Track a shipped parcel or delivery delay',
          packaging: 'Damaged box or wrapping after arrival',
          missing: 'Missing parts or materials from a kit',
          course: 'Cannot open course, activation, video or app errors',
          discount: 'Price, coupon, cheaper before checkout',
          rush: 'Need faster shipping or earlier dispatch',
          exceeds: 'Ask exceeds normal policy; hesitate, do not promise',
          photo_needed: 'A photo or screenshot from the customer is required next',
          greeting: 'Hello / is anyone there / no specific issue yet',
          other: 'Something else',
        },
      },
      exceeds: {
        type: 'noul',
        instructions:
          'Does the customer ask for something beyond normal policy (extra discount, special rush, free extras, a promise you cannot make)?',
      },
    },
  }
}

const DEPTS: readonly JevDepartment[] = ['billing', 'technical', 'sales']

function noulOf(body: any, key: string): number | undefined {
  const n = Number(body && body.answers && body.answers[key] && body.answers[key].noul)
  return Number.isFinite(n) ? n : undefined
}

function choiceOf<T extends string>(body: any, key: string, allowed: readonly T[]): T | undefined {
  const raw = String((body && body.answers && body.answers[key] && body.answers[key].choice) || '')
  return allowed.includes(raw as T) ? (raw as T) : undefined
}

export function parseJevBody(body: any): JevResult | null {
  const model = String((body && body.model) || '')
  const urgency = noulOf(body, 'urgency')
  const department = choiceOf(body, 'department', DEPTS)
  if (!model || urgency == null || !department) return null
  const orderStatus = choiceOf(body, 'orderStatus', JEV_ORDER)
  const emotionStatus = choiceOf(body, 'emotionStatus', JEV_EMOTION)
  const severity = choiceOf(body, 'severity', JEV_SEVERITY)
  const responsibility = choiceOf(body, 'responsibility', JEV_RESP)
  const needStatus = choiceOf(body, 'needStatus', JEV_NEED)
  const topic = choiceOf(body, 'topic', JEV_TOPICS) || (needStatus && JEV_TOPICS.includes(needStatus as JevTopic) ? (needStatus as JevTopic) : undefined)
  const exceeds = noulOf(body, 'exceeds')
  return {
    model,
    urgency,
    department,
    ...(topic ? { topic } : {}),
    ...(orderStatus ? { orderStatus } : {}),
    ...(emotionStatus ? { emotionStatus } : {}),
    ...(severity ? { severity } : {}),
    ...(responsibility ? { responsibility } : {}),
    ...(needStatus ? { needStatus } : {}),
    ...(exceeds != null ? { exceeds } : {}),
  }
}

function envVersion(): string {
  return String(process.env.WX_ENV_VERSION || process.env.TCB_ENV_VERSION || '').toLowerCase()
}

/**
 * 正式（release 字面或未开闸）= 旧关键词路。
 * 闸开 = Jev 总分流（自由文本不再走关键词气泡）。
 * 企微回调拿不到小程序 envVersion，所以体验环境靠 JEV_CS_ROUTE=1（env 或 secureConfig/typesafe）。
 */

/** 闸开时 Jev/话术挂了：短句请重试，不回旧关键词气泡。 */
export const JEV_FAIL_OPEN_TEXT = '刚才遇到点问题，请稍后再发一次，或点「找人工」🙏'
export async function loadJevGate(db: any): Promise<{ on: boolean; key: string }> {
  const ver = envVersion()
  if (ver === 'release') return { on: false, key: '' }
  const envFlag = process.env.JEV_CS_ROUTE === '1'
  const trialish = ver === 'develop' || ver === 'trial'
  const envKey = String(process.env.TYPESAFE_API_KEY || '')
  const got = await db
    .collection(COLLECTIONS.secureConfig)
    .doc('typesafe')
    .get()
    .catch(() => null)
  const d = (got && got.data) || {}
  const dbFlag = String(d.JEV_CS_ROUTE || '') === '1'
  const dbKey =
    typeof d.TYPESAFE_API_KEY === 'string' && d.TYPESAFE_API_KEY
      ? d.TYPESAFE_API_KEY
      : typeof d.apiKey === 'string'
        ? d.apiKey
        : ''
  return { on: envFlag || trialish || dbFlag, key: envKey || dbKey }
}

export async function askJev(state: string, apiKey: string, fetchFn?: JevFetch): Promise<JevResult | null> {
  const doFetch: JevFetch | undefined = fetchFn || (globalThis as { fetch?: JevFetch }).fetch
  if (typeof doFetch !== 'function' || !apiKey || !state) return null
  const signal =
    typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(2500)
      : undefined
  const res = await doFetch(JEV_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(jevRequestBody(state)),
    signal,
  })
  if (!res || res.ok === false || (typeof res.status === 'number' && res.status >= 400)) return null
  return parseJevBody(await res.json())
}

/** 非密钥证据：模型号 / 1→4 路由字段 / 需求 / 科室。不打 key、不打原文、不打 Authorization。 */
export function logJevEvidence(
  ev: JevResult,
  mapped: string | null,
  extra?: { stateLen?: number; skipped?: string; node?: string; topic?: string; acting?: string; checkpoint?: string }
): void {
  console.info('[kf] jev', {
    model: ev.model,
    urgency: ev.urgency,
    department: ev.department,
    orderStatus: ev.orderStatus || null,
    emotionStatus: ev.emotionStatus || null,
    severity: ev.severity || null,
    responsibility: ev.responsibility || null,
    needStatus: ev.needStatus || null,
    topic: extra && extra.topic != null ? extra.topic : ev.topic || null,
    exceeds: ev.exceeds,
    mapped,
    ...(extra && extra.node ? { node: extra.node } : {}),
    ...(extra && extra.acting ? { acting: extra.acting } : {}),
    ...(extra && extra.checkpoint ? { checkpoint: extra.checkpoint } : {}),
    ...(extra && extra.stateLen != null ? { stateLen: extra.stateLen } : {}),
    ...(extra && extra.skipped ? { skip: extra.skipped } : {}),
  })
}

/** 闸开后调用（key 取自调用方已读的 loadJevGate）。无 key / Jev 失败 → null，由调用方发短句，不弹气泡。 */
export async function tryJevClassify(key: string, text: string): Promise<JevResult | null> {
  if (!key) {
    console.info('[kf] jev', { skip: 'no-key' })
    return null
  }
  const ev = await askJev(text, key).catch(() => null)
  if (!ev) console.info('[kf] jev', { skip: 'fail-open' })
  return ev
}

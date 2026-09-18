/**
 * 企微客服自由文本上的 TypeSafe/Jev 分流（体验/开发取证·正式默认关）。
 * 官方入口：POST https://api.typesafe.ai/v1/systemone（Bearer TYPESAFE_API_KEY）。
 * 密钥只从运行时 env / secureConfig.typesafe 读，禁止写进仓库或日志。
 */

import { COLLECTIONS } from '@ldrw/shared'

export const JEV_URL = 'https://api.typesafe.ai/v1/systemone'
export const JEV_MODEL = 'jev-latest'

export type JevDepartment = 'billing' | 'technical' | 'sales'
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
export type JevResult = {
  model: string
  urgency: number
  department: JevDepartment
  topic?: JevTopic | null
  exceeds?: number
  negative?: number
  photo?: number
}

type JevFetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }
) => Promise<{ ok?: boolean; status?: number; json: () => Promise<any> }>

/** 官方请求体：state=进线原文，questions=urgency(noul)+department(choice)。 */
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
      topic: {
        type: 'choice',
        instructions: 'Which Lucky Ducky customer-service topic is this?',
        criteria: {
          logistics: 'Shipped package tracking, delivery delay, where is my parcel',
          packaging: 'Damaged box or wrapping after arrival',
          missing: 'Missing parts or materials from a kit',
          course: 'Cannot open course, activation, video or app errors',
          discount: 'Price, coupon, cheaper before checkout',
          rush: 'Need faster shipping or earlier dispatch',
          greeting: 'Hello / is anyone there / no specific issue yet',
          other: 'Something else',
        },
      },
      exceeds: {
        type: 'noul',
        instructions:
          'Does the customer ask for something beyond normal policy (extra discount, special rush, free extras, a promise you cannot make)?',
      },
      negative: {
        type: 'noul',
        instructions: 'Is the customer upset, angry, or complaining?',
      },
      photo: {
        type: 'noul',
        instructions:
          'Would a photo or screenshot from the customer help (damage, missing parts, error screen)?',
      },
    },
  }
}

const DEPTS: readonly JevDepartment[] = ['billing', 'technical', 'sales']

function noulOf(body: any, key: string): number | undefined {
  const n = Number(body && body.answers && body.answers[key] && body.answers[key].noul)
  return Number.isFinite(n) ? n : undefined
}

export function parseJevBody(body: any): JevResult | null {
  const model = String((body && body.model) || '')
  const urgency = Number(body && body.answers && body.answers.urgency && body.answers.urgency.noul)
  const department = String(
    (body && body.answers && body.answers.department && body.answers.department.choice) || ''
  )
  if (!model || !Number.isFinite(urgency) || !DEPTS.includes(department as JevDepartment)) return null
  const topicRaw = String((body && body.answers && body.answers.topic && body.answers.topic.choice) || '')
  const topic = JEV_TOPICS.includes(topicRaw as JevTopic) ? (topicRaw as JevTopic) : undefined
  const exceeds = noulOf(body, 'exceeds')
  const negative = noulOf(body, 'negative')
  const photo = noulOf(body, 'photo')
  return {
    model,
    urgency,
    department: department as JevDepartment,
    ...(topic ? { topic } : {}),
    ...(exceeds != null ? { exceeds } : {}),
    ...(negative != null ? { negative } : {}),
    ...(photo != null ? { photo } : {}),
  }
}

/** Jev 科室 → 现有关键词类别（只用于「没打中关键词」时的菜单；命中关键词仍走旧路）。 */
export function mapJevDepartment(department: string): 'aftersale' | 'activation' | 'tutorial' | null {
  if (department === 'billing') return 'aftersale'
  if (department === 'technical') return 'activation'
  if (department === 'sales') return 'tutorial'
  return null
}

export function jevHitWord(department: string): string {
  if (department === 'billing') return '售后'
  if (department === 'technical') return '课程'
  if (department === 'sales') return '教程'
  return '该分类'
}

function envVersion(): string {
  return String(process.env.WX_ENV_VERSION || process.env.TCB_ENV_VERSION || '').toLowerCase()
}

/**
 * 正式（release 字面或未开闸）= 旧关键词路。
 * 企微回调拿不到小程序 envVersion，所以体验环境靠 JEV_CS_ROUTE=1（env 或 secureConfig/typesafe）。
 */
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

/** 非密钥证据：模型号 / 紧急度 / 科室 / 映射结果。不打 key、不打原文、不打 Authorization。 */
export function logJevEvidence(
  ev: JevResult,
  mapped: string | null,
  extra?: { stateLen?: number; skipped?: string; node?: string; topic?: string }
): void {
  console.info('[kf] jev', {
    model: ev.model,
    urgency: ev.urgency,
    department: ev.department,
    topic: extra && extra.topic != null ? extra.topic : ev.topic || null,
    exceeds: ev.exceeds,
    mapped,
    ...(extra && extra.node ? { node: extra.node } : {}),
    ...(extra && extra.stateLen != null ? { stateLen: extra.stateLen } : {}),
    ...(extra && extra.skipped ? { skip: extra.skipped } : {}),
  })
}

/** 闸关 / 无 key / Jev 失败 → null（调用方走旧关键词/根菜单）。 */
export async function tryJevClassify(db: any, text: string): Promise<JevResult | null> {
  try {
    const gate = await loadJevGate(db)
    if (!gate.on) return null
    if (!gate.key) {
      console.info('[kf] jev', { skip: 'no-key' })
      return null
    }
    const ev = await askJev(text, gate.key)
    if (!ev) {
      console.info('[kf] jev', { skip: 'fail-open' })
      return null
    }
    return ev
  } catch {
    console.info('[kf] jev', { skip: 'fail-open' })
    return null
  }
}

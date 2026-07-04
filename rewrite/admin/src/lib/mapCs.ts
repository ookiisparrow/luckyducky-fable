// 客服组映射（纯函数·守卫 rw-admin-cs-ui-golden）：时长人话/报表 approx 诚实透传/
// 360 单面板 error 隔离（一处挂不能全黑·与云端编排同精神）/命中依据中文/kb 行归一。
import { dateTime } from './format'

/** 毫秒 → 人话（32 秒 / 4 分 10 秒 / 2 小时 5 分）。非法回 '—'。 */
export function msHuman(v: unknown): string {
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) return '—'
  const s = Math.round(n / 1000)
  if (s < 60) return `${s} 秒`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} 分 ${s % 60} 秒`
  return `${Math.floor(m / 60)} 小时 ${m % 60} 分`
}

export interface ReportVM {
  sampleNote: string
  volume: Array<{ label: string; value: string }>
  response: Array<{ label: string; value: string }>
  sla: Array<{ label: string; value: string }>
}

export function mapReport(r: unknown): ReportVM | null {
  const d = (r && typeof r === 'object' ? r : {}) as Record<string, any>
  if (d.ok !== true || !d.volume) return null
  const v = d.volume
  const resp = d.response || {}
  const sla = d.sla || {}
  return {
    sampleNote: d.approx ? `近 ${Number(d.sampleSize) || 0} 条估算（触样本顶·近似）` : `样本 ${Number(d.sampleSize) || 0} 条（全量精确）`, // approx 诚实透传
    volume: [
      { label: '总消息', value: String(Number(v.messages) || 0) },
      { label: '客户发来', value: String(Number(v.inbound) || 0) },
      { label: '我们回复', value: String(Number(v.outbound) || 0) },
      { label: '客户数', value: String(Number(v.customers) || 0) },
    ],
    response: [
      { label: '首次响应均值', value: msHuman(resp.avgResponseMs) },
      { label: '最长响应', value: msHuman(resp.maxResponseMs) },
      { label: '答复率', value: (Number(resp.answeredRate) || 0) + '%' },
      { label: '未答复', value: String(Number(resp.unanswered) || 0) },
    ],
    sla: [
      { label: 'SLA 阈值', value: msHuman(sla.slaMs) },
      { label: '超时数', value: String(Number(sla.breaches) || 0) },
      { label: '超时占比', value: (Number(sla.breachRate) || 0) + '%' },
    ],
  }
}

export interface MsgVM {
  id: string
  who: string
  text: string
  timeLabel: string
  channel: string
}

export function mapMessages(list: unknown): MsgVM[] {
  if (!Array.isArray(list)) return []
  const out: MsgVM[] = []
  for (const m of list as Record<string, any>[]) {
    if (!m || typeof m !== 'object') continue
    out.push({
      id: String(m.id || ''),
      who: m.direction === 'out' ? '客服' : '客户', // 方向中文
      text: String(m.text || `[${String(m.msgtype || '非文本')}]`),
      timeLabel: dateTime(m.at),
      channel: String(m.channel || ''),
    })
  }
  return out
}

const MATCH_LABELS: Record<string, string> = { openid: '账号', phone: '手机号', nickname: '昵称', orderId: '订单号' }
export const matchLabel = (by: unknown): string => (Array.isArray(by) ? by.map((b) => MATCH_LABELS[String(b)] || String(b)).join('/') : '')

export interface PanelVM {
  key: string
  label: string
  failed: boolean
  rows: Array<{ k: string; v: string }>
}

// profile 面板字段人话（其余面板 generic 键值——防过度：真实形状随用随补）
const PROFILE_LABELS: Record<string, string> = {
  orderCount: '订单数',
  paidCount: '已付单数',
  totalSpent: '总消费（元）',
  activatedCount: '已激活课',
  enteredCount: '已进课',
  enterRate: '进课率 %',
  lastActiveAt: '最近活跃',
  ordersCapped: '（订单数触上限·总消费为近 N 单近似）',
}

export function mapPanels(r: unknown): PanelVM[] {
  const d = (r && typeof r === 'object' ? r : {}) as Record<string, any>
  if (!Array.isArray(d.panels)) return []
  return (d.panels as Record<string, any>[]).filter(Boolean).map((p) => {
    const failed = !!p.error
    const rows: Array<{ k: string; v: string }> = []
    if (!failed && p.data && typeof p.data === 'object' && !Array.isArray(p.data)) {
      for (const [k, v] of Object.entries(p.data as Record<string, unknown>)) {
        if (v == null || v === false) continue
        const label = p.key === 'profile' ? PROFILE_LABELS[k] || k : k
        rows.push({ k: label, v: k === 'lastActiveAt' ? dateTime(v) || String(v) : Array.isArray(v) ? `${v.length} 条` : String(v) })
      }
    } else if (!failed && Array.isArray(p.data)) {
      rows.push({ k: '条数', v: String(p.data.length) })
    }
    return { key: String(p.key || ''), label: String(p.label || p.key || ''), failed, rows } // 单面板 error 隔离·其余照渲染
  })
}

export interface KbRow {
  key: string
  question: string
  answer: string
  category: string
  enabled: boolean
  order: number
}

export function normalizeKb(list: unknown): KbRow[] {
  if (!Array.isArray(list)) return []
  return (list as Record<string, any>[]).filter(Boolean).map((e) => ({
    key: String(e.key || ''),
    question: String(e.question || ''),
    answer: String(e.answer || ''),
    category: String(e.category || 'other'),
    enabled: e.enabled !== false,
    order: Number(e.order) || 0,
  }))
}

export function mapCsat(r: unknown): { total: number; avg: string; dist: Array<{ star: string; n: number }>; withNote: number; approxNote: string } | null {
  const d = (r && typeof r === 'object' ? r : {}) as Record<string, any>
  if (d.ok !== true) return null
  const dist = d.dist && typeof d.dist === 'object' ? d.dist : {}
  return {
    total: Number(d.total) || 0,
    avg: String(d.avg ?? 0),
    dist: [5, 4, 3, 2, 1].map((s) => ({ star: s + ' 星', n: Number(dist[s]) || 0 })),
    withNote: Number(d.withNote) || 0,
    approxNote: d.approx ? '触样本顶·近似' : '',
  }
}

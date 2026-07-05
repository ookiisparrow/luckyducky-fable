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

export interface ReportItem {
  label: string
  value: string
  bad?: boolean // 异常指标（未答复/超时 > 0）·模板据此标红（换皮把异常和正常指标同色·质检扫不到）
}
export interface ReportVM {
  sampleNote: string
  volume: ReportItem[]
  response: ReportItem[]
  sla: ReportItem[]
}

export function mapReport(r: unknown): ReportVM | null {
  const d = (r && typeof r === 'object' ? r : {}) as Record<string, any>
  if (d.ok !== true || !d.volume) return null
  const v = d.volume
  const resp = d.response || {}
  const sla = d.sla || {}
  const unanswered = Number(resp.unanswered) || 0
  const breaches = Number(sla.breaches) || 0
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
      { label: '未答复', value: String(unanswered), bad: unanswered > 0 }, // >0 标红
    ],
    sla: [
      { label: 'SLA 阈值', value: msHuman(sla.slaMs) },
      { label: '超时数', value: String(breaches), bad: breaches > 0 }, // >0 标红
      { label: '超时占比', value: (Number(sla.breachRate) || 0) + '%' },
    ],
  }
}

export interface MsgVM {
  id: string
  who: string
  text: string
  kind: string // 非文本消息类型（image/voice…）·独立 chip；文本为 ''（换皮把类型吞进正文·丢了与文字并存的标识）
  timeLabel: string
  channel: string
}

export function mapMessages(list: unknown): MsgVM[] {
  if (!Array.isArray(list)) return []
  const out: MsgVM[] = []
  for (const m of list as Record<string, any>[]) {
    if (!m || typeof m !== 'object') continue
    const msgtype = String(m.msgtype || '')
    out.push({
      id: String(m.id || ''),
      who: m.direction === 'out' ? '客服' : '客户', // 方向中文
      text: String(m.text || ''),
      kind: msgtype && msgtype !== 'text' ? msgtype : '', // 非文本→类型 chip；与正文可并存
      timeLabel: dateTime(m.at),
      channel: String(m.channel || ''),
    })
  }
  return out
}

const MATCH_LABELS: Record<string, string> = { openid: '账号', phone: '手机号', nickname: '昵称', orderId: '订单号' }
export const matchLabel = (by: unknown): string => (Array.isArray(by) ? by.map((b) => MATCH_LABELS[String(b)] || String(b)).join('/') : '')

export interface PanelField {
  k: string
  v: string
}
export interface PanelGroupVM {
  name: string // 明细段名（订单/激活·课程/学习位置/节点照片）
  count: number
  capped: boolean // 超上界（余略）
  items: PanelField[][] // 每条明细 = 一组带标签的字段（1:1 承接旧台逐行键值卡片）
}
export interface PanelVM {
  key: string
  label: string
  failed: boolean
  rows: PanelField[] // 面板标量字段
  groups: PanelGroupVM[] // 嵌套数组明细分组（逐行逐字段·真复原·换皮误塌成「N 条」）
}

const GROUP_CAP = 50 // 明细逐行有界（防大客户拖垮·capacity·根因#7）

// 全字段人话名（覆盖 5 个 provider 的标量 + 明细字段·段名·未知字段回退原始 key·「后端给什么渲什么」）
const CS_LABELS: Record<string, string> = {
  // profile 标量
  orderCount: '订单数', ordersCapped: '订单超采样', paidCount: '已付单数', totalSpent: '总消费（元）',
  activatedCount: '已激活课', enteredCount: '已进课', enterRate: '进课率 %', lastActiveAt: '最近活跃',
  // 通用标量 + 明细段名
  count: '数量', capped: '超采样',
  orders: '订单', activations: '激活/课程', positions: '学习位置', photos: '节点照片',
  // 订单明细
  id: '单号', status: '状态', amount: '金额（元）', createdAt: '时间', itemCount: '件数', trackingNo: '运单号',
  // 激活明细
  courseId: '课程', code: '激活码', activated: '已激活', entered: '已进课', enteredAt: '进课时间',
  // 学习位置明细
  courseTitle: '课程', chapterTitle: '章', lessonName: '课时', segmentName: '小节',
  atSec: '进度（秒）', doneCount: '完成段', totalSegments: '总段', percent: '完成度 %', updatedAt: '更新',
  // 节点照片明细
  nodeId: '节点', title: '节点名', fileId: '文件',
}
const csLabel = (k: string): string => CS_LABELS[k] || k

// 值人话：布尔→是/否·结尾 At 的数字→时间·空→—
function fmtVal(k: string, v: unknown): string {
  if (v == null || v === '') return '—'
  if (typeof v === 'boolean') return v ? '是' : '否'
  if (/At$/.test(k) && typeof v === 'number') return dateTime(v) || String(v)
  return String(v)
}

// 一个嵌套数组 → 明细分组（逐行逐字段·保留 false 布尔＝有取证价值[未进课等]·只滤 null/空）
function buildGroup(name: string, arr: unknown[]): PanelGroupVM {
  const items: PanelField[][] = arr.slice(0, GROUP_CAP).map((item) => {
    if (item && typeof item === 'object') {
      return Object.entries(item as Record<string, unknown>)
        .filter(([, val]) => val != null && val !== '')
        .map(([kk, val]) => ({ k: csLabel(kk), v: fmtVal(kk, val) }))
    }
    return [{ k: '', v: String(item) }]
  })
  return { name: csLabel(name), count: arr.length, capped: arr.length > GROUP_CAP, items }
}

export function mapPanels(r: unknown): PanelVM[] {
  const d = (r && typeof r === 'object' ? r : {}) as Record<string, any>
  if (!Array.isArray(d.panels)) return []
  return (d.panels as Record<string, any>[]).filter(Boolean).map((p) => {
    const failed = !!p.error
    const rows: PanelField[] = []
    const groups: PanelGroupVM[] = []
    const data = p.data
    if (!failed && data && typeof data === 'object' && !Array.isArray(data)) {
      // 真实 provider 形状：对象含标量 + 嵌套数组。标量→rows；数组→逐行明细 groups（换皮误塌成「N 条」的真复原）
      for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
        if (Array.isArray(v)) {
          groups.push(buildGroup(k, v))
        } else {
          if (v == null || v === false) continue // 标量层不渲假值/空（避免 超采样:否 等噪声）
          rows.push({ k: csLabel(k), v: fmtVal(k, v) })
        }
      }
    } else if (!failed && Array.isArray(data)) {
      // 顶层数组（现 provider 不产此形状·留兜底）：整块成一个明细分组
      groups.push(buildGroup(String(p.key || 'items'), data as unknown[]))
    }
    return { key: String(p.key || ''), label: String(p.label || p.key || ''), failed, rows, groups } // 单面板 error 隔离·其余照渲染
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

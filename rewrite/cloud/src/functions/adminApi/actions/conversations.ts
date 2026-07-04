import { reply, type Ctx } from '../lib'
import { pageQuery } from '../../../kit'
import { COLLECTIONS } from '@ldrw/shared'

// 客服会话检索（后台360工作站 B5.1·板块#9·外包管控底座）：坐席按客户（openid / externalUserId）+ 渠道筛选 →
// cursor 翻页拉会话时间轴（归档单源 conversations·由 cs/kfCallback 落档）。供坐席查历史 + 质检取证（B5.3 依赖）。
//
// 越权读他人会话全文（§1.5·根因#3·同 360 读）：index.ts ACTION_CAPS['searchConversations']='customer:view' 能力闸
// + shouldAudit 默认留痕（search* 非 ^get·自动记「查了谁的会话」）——闸均在分发处收口（守卫 conversations-pii-gated），
// 本 action 只取参→分页→回结果、不自己碰审计/能力。
//
// bounded（守卫 conversations-search-bounded·根因#7）：一律经 kit pageQuery 游标分页（limit 钳 [1,200]·desc by at）——
// 杜绝裸 .get() 一次拉爆某客户长会话/全量会话拖垮工作台（同订单/评价分页·paging-contract）。
// keyword＝「当前页内」子串过滤（坐席沿时间轴翻页检索）；真全文检索须真 sdk db.RegExp + 索引（内存桩不复现·
// 根因#8 桩≠真）——故先页内过滤、不造不可测的全库模糊分支（防过度工程·留真机后升级）。
const DEFAULT_LIMIT = 30

export async function searchConversations({ db, data }: Ctx) {
  const d = data || {}
  // 客户范围（可选）：优先 openid（kfBind 绑定后稳定），否则 externalUserId；渠道可叠加（wxkf/未来承面C）。
  const openid = String(d.openid || '').trim()
  const externalUserId = String(d.externalUserId || '').trim()
  const channel = String(d.channel || '').trim()
  const filter: Record<string, any> = {}
  if (openid) filter.openid = openid
  else if (externalUserId) filter.externalUserId = externalUserId
  if (channel) filter.channel = channel
  // cursor 分页（bounded·d 携 cursor/limit）：按 at 倒序翻页，nextCursor 续取更早消息
  const paged = await pageQuery(db, COLLECTIONS.conversations, filter, 'at', d, DEFAULT_LIMIT)
  const keyword = String(d.keyword || '').trim().slice(0, 64)
  const rows = keyword ? paged.list.filter((m: any) => String(m.text || '').includes(keyword)) : paged.list
  const messages = rows.map((m: any) => ({
    id: m._id,
    channel: m.channel || '',
    direction: m.direction || '', // 'in'=客户·'out'=客服/机器人
    openid: m.openid || '',
    externalUserId: m.externalUserId || '',
    msgtype: m.msgtype || '',
    text: m.text || '',
    at: m.at || null,
  }))
  return reply(200, {
    ok: true,
    messages,
    count: messages.length,
    nextCursor: paged.nextCursor, // 续页游标（基于原始页·keyword 过滤不影响翻页继续找）
    hasMore: paged.hasMore,
  })
}

// ── 质检 + 报表 + SLA（B5.3·板块#11·依赖归档·车道 E）──
// 近 REPORT_SAMPLE 条会话的运营度量：会话量 / 首次响应时长 / SLA 达标 / 答复率。聚合属运营统计（无逐人 PII·同
// dashboard 不另设 cap 闸）。bounded 样本读（守卫 conversations-report-bounded·根因#7/#18·超量标 approx·同 dashboard）。
// 配对口径：按客户（externalUserId 优先·稳定·无则 openid）把消息按 at 升序，每条入站找其后首个出站算「首次响应」。
// 诚实标注（根因#8）：当前出站含机器人自动应答（近实时）→首响多近 0；人工接待时长待承面C 人工回复落档后才显著。
const REPORT_SAMPLE = 1000
const DEFAULT_SLA_MS = 5 * 60_000 // 首次响应 SLA 默认 5 分钟（前端可传 slaMs 覆盖）

export async function conversationsReport({ db, data }: Ctx) {
  const d = data || {}
  const slaMs = Math.max(0, Number(d.slaMs) || DEFAULT_SLA_MS)
  const channel = String(d.channel || '').trim()
  const filter: Record<string, any> = {}
  if (channel) filter.channel = channel
  // bounded 样本（最近 SAMPLE 条·orderBy at desc·守卫 conversations-report-bounded·防全量扫拖垮）
  const res = await db
    .collection(COLLECTIONS.conversations)
    .where(filter)
    .orderBy('at', 'desc')
    .limit(REPORT_SAMPLE)
    .get()
    .catch(() => ({ data: [] }))
  const rows: any[] = (res && res.data) || []

  let inbound = 0
  let outbound = 0
  const byCustomer = new Map<string, any[]>()
  for (const m of rows) {
    if (m.direction === 'in') inbound++
    else if (m.direction === 'out') outbound++
    const key = String(m.externalUserId || m.openid || '')
    if (!key) continue
    const arr = byCustomer.get(key) || []
    arr.push(m)
    byCustomer.set(key, arr)
  }

  // 首次响应配对：每客户消息按 at 升序，每条入站找其后首个出站算 delta（答复）；无后续出站＝未答复（unanswered）。
  const deltas: number[] = []
  let unanswered = 0
  for (const msgs of byCustomer.values()) {
    const sorted = msgs.slice().sort((a, b) => (Number(a.at) || 0) - (Number(b.at) || 0))
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i].direction !== 'in') continue
      const inAt = Number(sorted[i].at) || 0
      let replyAt = 0
      for (let j = i + 1; j < sorted.length; j++) {
        if (sorted[j].direction === 'out') {
          replyAt = Number(sorted[j].at) || 0
          break
        }
      }
      if (replyAt && replyAt >= inAt) deltas.push(replyAt - inAt)
      else unanswered++
    }
  }
  const answered = deltas.length
  const avgResponseMs = answered ? Math.round(deltas.reduce((s, x) => s + x, 0) / answered) : 0
  const maxResponseMs = answered ? Math.max(...deltas) : 0
  const breaches = deltas.filter((x) => x > slaMs).length
  const pct = (n: number) => Math.round(n * 1000) / 10 // 百分比·一位小数
  return reply(200, {
    ok: true,
    sampleSize: rows.length,
    approx: rows.length >= REPORT_SAMPLE, // 触顶＝近似（只算样本·同 dashboard）
    slaMs,
    volume: { messages: rows.length, inbound, outbound, customers: byCustomer.size },
    // 答复率＝有出站回复的入站占比（解决率近似·MVP·承面C 人工接入后更准）
    response: { avgResponseMs, maxResponseMs, answered, unanswered, answeredRate: inbound ? pct(answered / inbound) : 0 },
    // SLA：首次响应超 slaMs 的占比（已答复中）+ 未答复数（也算违约信号）
    sla: { slaMs, breaches, breachRate: answered ? pct(breaches / answered) : 0, unanswered },
  })
}

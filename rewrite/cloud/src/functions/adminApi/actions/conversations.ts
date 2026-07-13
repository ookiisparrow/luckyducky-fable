import { reply, str, type Ctx } from '../lib'
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

// ── 质检抽检（B7·板块#11 续）──
// 粒度＝客户会话档级（csSession 文档，非「轮次」——csSession 跨轮复用重开、消息无 sessionId，轮次实体不存在，
// 见 docs/待办与债.md flag）。sessionKey＝csSession._id（形如 `wxkf:<openKfId>:<externalUserId>`——**不是**
// externalUserId：csat.ts 的明细行已改名为 externalUserId 字段、不再借用 sessionKey 之名，这里前端跳「查会话」
// 时仍须解出 externalUserId 传给 searchConversations，别把 csSession._id 当 externalUserId 传错接口）。
// 鉴权：均走 adminApi 现行机制——本文件三个 action 都不登记 ACTION_CAPS（见 index.ts），默认高权
// ADMIN_DEFAULT_CAP='admin:write'，坐席（cap 仅 agent:handle）一律 403 不可达；审计走 shouldAudit 现行装置
// （sampleQc/saveQcMark 不以 list/get/upload 起首、非 ping/login → 自动留痕；listQcSampled 以 list 起首、
// 同其余只读列表 action 一样不强制审计）。
const QC_POOL_LIMIT = 200 // 候选池有界（根因#7）：只看最近 200 条 closed 会话，不全量扫描
const QC_SAMPLE_MAX = 50 // 单次抽样条数上限（防误传超大 count 一次性抽空候选池）
const QC_CUSTOMER_READ_LIMIT = 200 // 单客户聚合的有界读（同 conversationsReport 口径的按客户配对，规模缩到单客户）
const QC_LIST_DEFAULT_LIMIT = 20
const QC_NOTE_MAX = 500

// 按客户聚合消息数 + 首次响应均值（复用 conversationsReport 的配对口径：入站找其后首个出站算 delta）——
// 范围＝该客户「近期」消息（有界读 QC_CUSTOMER_READ_LIMIT 条，非该次 closed 会话独有的消息，跨会话累计；
// 不发明轮次切片，UI 需诚实标注「按该客户近期消息聚合」）。查询失败/无客户标识 → null（调用方据此省略字段）。
async function computeCustomerAgg(db: any, externalUserId: string): Promise<{ messageCount: number; avgResponseMs: number } | null> {
  const euid = String(externalUserId || '')
  if (!euid) return null
  const res = await db
    .collection(COLLECTIONS.conversations)
    .where({ externalUserId: euid })
    .orderBy('at', 'desc')
    .limit(QC_CUSTOMER_READ_LIMIT)
    .get()
    .catch(() => null)
  if (!res) return null
  const rows: any[] = (res && res.data) || []
  const sorted = rows.slice().sort((a, b) => (Number(a.at) || 0) - (Number(b.at) || 0))
  const deltas: number[] = []
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
  }
  const avgResponseMs = deltas.length ? Math.round(deltas.reduce((s, x) => s + x, 0) / deltas.length) : 0
  return { messageCount: rows.length, avgResponseMs }
}

/**
 * sampleQc {count=10}：候选＝csSession where status='closed' 的有界池（≤200·orderBy updatedAt desc）——
 * **内存过滤**掉已有 `qc`（已评）或 `qcSampledAt`（已抽过）的（不放进 db where，query 只按 status 取池，
 * 「未质检」判定在内存做，见规格）。从剩余候选随机抽 count 条，逐条写 `qcSampledAt: now`——
 * 单条写失败跳过不炸整批（该条不计入返回结果，视为未真正抽中）。返回列表带按客户聚合的消息数/首响
 * （聚合失败该字段省略，不编数）。
 */
export async function sampleQc({ db, data }: Ctx): Promise<any> {
  const d = data || {}
  const count = Math.max(1, Math.min(QC_SAMPLE_MAX, Number(d.count) || 10))
  const res = await db
    .collection(COLLECTIONS.csSession)
    .where({ status: 'closed' })
    .orderBy('updatedAt', 'desc')
    .limit(QC_POOL_LIMIT)
    .get()
    .catch(() => ({ data: [] }))
  const rows: any[] = (res && res.data) || []
  // 已知限制（docs/待办与债.md flag）：qc/qcSampledAt 挂在可被重开复用的 csSession 文档上——顾客二次
  // 「找人工」时 cs/kfCallback/dispatch.ts enqueueSession 把同一 _id 的 doc closed→pending 重开，只刷新
  // agentId/claimedAt/createdAt/updatedAt 四个字段，不清 qc/qcSampledAt；该文档此后再次 closed，本次 filter
  // 仍会因旧 qc/qcSampledAt 非空把它排除出候选池——同一客户被评过一次后，其后全新的会话永远进不了这里的
  // 候选池，listQcSampled 也会一直展示那份过期评分。根治须改 dispatch.ts 重开分支（本批白名单不含该文件，
  // 未做）；本批仅记账，不在此臆造轮次实体或时间戳启发式去猜「是否重开过」。
  const candidates = rows.filter((s: any) => !s.qc && !s.qcSampledAt)
  // Fisher-Yates 部分洗牌（池已有界·简单实现足够）
  const pool = candidates.slice()
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  const picked = pool.slice(0, count)
  const now = Date.now()
  const sampled: any[] = []
  for (const s of picked) {
    try {
      await db.collection(COLLECTIONS.csSession).doc(s._id).update({ data: { qcSampledAt: now } })
    } catch {
      continue // 单条写失败跳过不炸整批——该条未真正抽中，不进入返回列表
    }
    const agg = await computeCustomerAgg(db, String(s.externalUserId || ''))
    sampled.push({
      sessionKey: s._id,
      externalUserId: s.externalUserId || '',
      updatedAt: Number(s.updatedAt) || 0,
      qcSampledAt: now,
      ...(agg ? { messageCount: agg.messageCount, avgResponseMs: agg.avgResponseMs } : {}),
    })
  }
  return reply(200, { ok: true, sampled, count: sampled.length })
}

/**
 * saveQcMark {sessionKey, score, note}：score 服务端校验 1-5 整数（越界/非整拒）；note trim 后截断
 * （同全仓 `str()` 截断惯例，不整条拒绝）；目标 csSession 不存在→404；已有 `qc`（已评）→409 ALREADY_MARKED
 * 拒覆盖（防误触二次评分覆盖前一评审员的结论）；写 `qc:{score,note,by,at}`——by 取 ctx.agentId（现行审计
 * 操作者身份口径：超管固定 'admin'、外包＝账号 _id，同 index.ts 分发处 operator/agentId 贯入同一套认证主体）。
 *
 * 原子抢占（同 approveRefund 既有 CAS 范式·根治读-判-写三步 TOCTOU）：「已有 qc→409」不是先 get() 读检查、
 * 再单独 update() 写——那样两个并发评审员的保存请求都可能读到 qc 为空、都通过检查、都写入，后写方悄悄覆盖
 * 前一评审员的结论而不触发 409。改用 `where({_id, qc: exists(false)}).update()` 条件写，抢不到（updated!==1）
 * 即 409——与「已有 qc」和「并发写丢了这一抢」两种情况合并同一 409 语义，均不覆盖既有评分。
 */
export async function saveQcMark({ db, data, agentId }: Ctx): Promise<any> {
  const d = data || {}
  const sessionKey = String(d.sessionKey || '').trim()
  if (!sessionKey) return reply(400, { ok: false, error: 'BAD_ARGS' })
  const score = Number(d.score)
  if (!Number.isInteger(score) || score < 1 || score > 5) return reply(400, { ok: false, error: 'BAD_ARGS:SCORE_RANGE' })
  const note = str(d.note, QC_NOTE_MAX).trim()
  const got = await db.collection(COLLECTIONS.csSession).doc(sessionKey).get().catch(() => null)
  const s = got && got.data ? got.data : null
  if (!s) return reply(404, { ok: false, error: 'NOT_FOUND' })
  const now = Date.now()
  const _ = db.command
  const r = await db
    .collection(COLLECTIONS.csSession)
    .where({ _id: sessionKey, qc: _.exists(false) })
    .update({ data: { qc: { score, note, by: String(agentId || 'admin'), at: now } } })
  if (!r || !r.stats || r.stats.updated !== 1) return reply(409, { ok: false, error: 'ALREADY_MARKED' })
  return reply(200, { ok: true })
}

/**
 * listQcSampled {cursor,limit,onlyPending}：cursor 分页取「已抽样」的会话（where qcSampledAt exists·
 * cursorField=qcSampledAt·kit pageQuery 复合游标）；onlyPending=true 时叠加 qc 不存在（只看未评的）。
 * 行内聚合字段（消息数/首响）与 sampleQc 同口径同源——「加载更多」翻出的行与初次抽样行列齐全一致
 * （聚合失败该字段省略，不编数）。
 */
export async function listQcSampled({ db, data }: Ctx): Promise<any> {
  const d = data || {}
  const onlyPending = !!d.onlyPending
  const _ = db.command
  const filter: Record<string, any> = { qcSampledAt: _.exists(true) }
  if (onlyPending) filter.qc = _.exists(false)
  const paged = await pageQuery(db, COLLECTIONS.csSession, filter, 'qcSampledAt', d, QC_LIST_DEFAULT_LIMIT)
  const list = await Promise.all(
    paged.list.map(async (s: any) => {
      const agg = await computeCustomerAgg(db, String(s.externalUserId || ''))
      return {
        sessionKey: s._id,
        externalUserId: s.externalUserId || '',
        updatedAt: Number(s.updatedAt) || 0,
        qcSampledAt: Number(s.qcSampledAt) || 0,
        qc: s.qc || null,
        ...(agg ? { messageCount: agg.messageCount, avgResponseMs: agg.avgResponseMs } : {}),
      }
    }),
  )
  return reply(200, { ok: true, list, nextCursor: paged.nextCursor, hasMore: paged.hasMore })
}

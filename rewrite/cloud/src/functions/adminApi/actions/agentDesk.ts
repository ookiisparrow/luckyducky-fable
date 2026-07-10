import { reply, str, type Ctx } from '../lib'
import { transition, pageParams, pageQuery, assertOwnedByAgent, assertDataShareConsent, sendAgentCard, AGENT_DESK_URL, notifyAlert } from '../../../kit'
import { COLLECTIONS } from '@ldrw/shared'
import { assembleCustomer360 } from '../customer360/orchestrator'

// 承面 C 外包会话工作台·坐席台后端（B6.1–6.3·板块#12）。实现 shared/csAgentDesk.ts 契约的 8 个 action：
//   listQueue / claimConversation / releaseConversation / sendAgentMessage / getThread /
//   setAgentStatus / escalateToMerchant / closeConversation。
//
// 落点＝adminApi actions（复用口令闸/checkKey/ACTION_CAPS 能力闸）。均须 cap `agent:handle`（外包最小权·§1 定稿·
// 根因#3）——wire 在 adminApi/index.ts ACTION_CAPS + lib.ts ROLES.outsourced（与本文件同批落·不空守）。
//
// 信任边界（§1.5·根因#3 不信前端）：坐席身份 `agentId` 一律取自 checkKey 解析的**认证主体**（Ctx.agentId，
// 非 data 里前端传的）——防冒名认领/发消息。分配 scope：外包只能读/操作**自己 claim 的会话**（ownsSession·
// 超管 '*' 全量）；守卫 outsourced-reads-scoped（车道 C 定义）合并后覆盖此不变量，本文件先落最小运行时校验。
//
// 状态流转一律走 kit `transition('csSession', …)`（合法流转单源 shared/cs.spec.ts·守卫 order-transitions-declared
// 对账·私自越流转即红·根因#2）；一次性副作用绑首次转移（transition moved===true·天然幂等·根因#1）。
// 读路径 bounded（cursor/limit·守卫 capacity-reads-bounded·根因#7）。发送经 cs/kfSend 服务端接缝（平台接缝
// 单点·根因#12·不在 adminApi 复制 token/sendMsg 逻辑·避 WXKF env 双份）。

const LIST_LIMIT = 20 // 待接队列默认页大小（bounded）
const THREAD_LIMIT = 50 // 会话消息流默认页大小（bounded）
const MAX_TEXT = 2000 // 坐席回复文本上限（防超长入库/发送）
const DEFAULT_AGENT_LIMIT = 5 // 默认接待上限（agentState.limit 未配时）
const CHANNEL = 'wxkf' // 出站归档 channel（与 kfCallback archiveOutbound 同口径·多承面区分位）
const AGENT_STATUS = ['online', 'busy', 'offline'] as const
// 会话结束满意度提示（触 CSAT·契约 closeConversation「触评分气泡」）：结束时最佳努力发给顾客，
// 顾客回复 1-5 由 cs/kfCallback dispatch recordCsat 归档（已在·B4.3）——本处只发提示、不自己写 csat。
const CSAT_PROMPT = '感谢你的咨询～这次服务还满意吗？回复 1-5 分帮我们改进（5 分最满意）🙏'

// 认证主体（根因#3 不信前端）：agentId＝checkKey 解析的账号 _id（外包账号 adminConfig._id / 超管 'admin'），
// 经 adminApi/index.ts 分发处贯入 Ctx（非 data 传入）。isSuper＝caps 含 '*'（商户超管·可读/操作全量会话）。
function principal(ctx: Ctx): { agentId: string; isSuper: boolean } {
  const agentId = String((ctx as any).agentId || '')
  const caps: string[] = Array.isArray((ctx as any).caps) ? (ctx as any).caps : []
  return { agentId, isSuper: caps.includes('*') }
}

// 分配 scope + 载入会话（§1.5·根因#3·防批量导出）：超管全量（loadSession）；外包经 kit 单源闸 assertOwnedByAgent
// （会话须存在且 agentId===本坐席·fail-closed·单源 kit/csAccess·守卫 outsourced-reads-scoped 焊 per-session action 必引它）。
// 返回 { code, s? }：code=0 通过（s＝会话）；404 会话不存在；403 非本坐席 claim（越 scope 拒）。整合统一：原内联 ownsSession
// 与车道 C 的 assertOwnedByAgent 同一不变量两处表达（根因#5）→ 收敛到 kit 闸单源（超管 bypass 留调用侧·避双读）。
async function scopedLoad(db: any, p: { agentId: string; isSuper: boolean }, sessionId: string): Promise<{ code: number; s?: any }> {
  if (p.isSuper) {
    const s = await loadSession(db, sessionId)
    return s ? { code: 0, s } : { code: 404 }
  }
  const sc = await assertOwnedByAgent(db, p.agentId, sessionId)
  return sc.ok ? { code: 0, s: sc.session } : { code: sc.error === 'NO_SESSION' ? 404 : 403 }
}

// SessionView 映射（契约 shared/csAgentDesk.ts·可带额外字段）。openid 由 resolveOpenid 异步补（身份桥接）。
function toView(s: any, openid: string | null): any {
  return {
    sessionId: s._id,
    externalUserId: s.externalUserId || '',
    openKfId: s.openKfId || '',
    status: s.status,
    createdAt: Number(s.createdAt) || 0,
    updatedAt: Number(s.updatedAt) || 0,
    openid,
    agentId: s.agentId || null,
    claimedAt: Number(s.claimedAt) || null,
  }
}

// 身份桥接 openid（kfIdentity ext→openid·供前端联动 getCustomer360 侧栏·§B2 360 嵌入）：会话上有则用，
// 否则查 kfIdentity 映射（best-effort·未绑定返 null）。内联 1 行读·不跨域 import kfCallback（解耦·铁律二）。
async function resolveOpenid(db: any, s: any): Promise<string | null> {
  if (s.openid) return String(s.openid)
  const euid = String(s.externalUserId || '')
  if (!euid) return null
  const got = await db.collection(COLLECTIONS.kfIdentity).doc('ext:' + euid).get().catch(() => null)
  return (got && got.data && got.data.openid) || null
}

// 坐席接待上限（agentState.limit·未配回默认）。
async function agentLimit(db: any, agentId: string): Promise<number> {
  const got = await db.collection(COLLECTIONS.agentState).doc(agentId).get().catch(() => null)
  const lim = got && got.data ? Number(got.data.limit) : 0
  return lim && lim > 0 ? lim : DEFAULT_AGENT_LIMIT
}

// 坐席当前在接会话数（**派生**·防计数漂移·根因#8 桩≠真里的 inc 也不复现）：直接 count 本坐席 active 会话，
// 不维护 agentState.activeCount 手写计数器（claim/release/close/escalate 后自动准确·无 TOCTOU 漂移）。
async function activeCountFor(db: any, agentId: string): Promise<number> {
  const r = await db.collection(COLLECTIONS.csSession).where({ agentId, status: 'active' }).count().catch(() => ({ total: 0 }))
  return (r && r.total) || 0
}

// 入站消息全局唯一 id（bug sweep II L1）：conversations 无独立 msgid 字段，入站客户消息的 msgid 编码在
// 确定性 _id='wxkf:in:<msgid>'（见 cs/kfCallback/archive.ts archiveInbound）——从 _id 剥前缀取回，不新增
// 落库字段（archive.ts 幂等 _id 设计已够用，改它不在本次改动范围）。出站坐席消息 _id 自动生成、不含
// msgid 语义，原样返回 undefined（desk.ts keyOf 按规格回退到 at|direction|msgtype|text 旧键）。
const INBOUND_ID_PREFIX = 'wxkf:in:'
function inboundMsgid(id: unknown): string | undefined {
  const s = String(id || '')
  return s.startsWith(INBOUND_ID_PREFIX) ? s.slice(INBOUND_ID_PREFIX.length) : undefined
}

// 读一条会话（缺失返 null·同 doc().get() reject 兜底）。
async function loadSession(db: any, sessionId: string): Promise<any | null> {
  const got = await db.collection(COLLECTIONS.csSession).doc(sessionId).get().catch(() => null)
  return got && got.data ? got.data : null
}

// ── ① listQueue：待接队列（pending 会话·FIFO createdAt 升序·bounded cursor/limit·根因#7）──
// 待接队列对所有坐席可见（pending 会话无归属·可被任一坐席认领）；分配 scope 只在认领后的读/操作侧生效。
// 超管队列另含 escalated（外包甩单只有商户能看见/重接——否则 escalateToMerchant 是黑洞·接真接口批补）。
// 分页接 kit `pageQuery(..., 'asc')`（Round8·根因#7 收口最后一处）：原手写 `createdAt: _.gt(cursor)` 单字段
// 游标同值多条会被 gt 严格条件永久跳过（撞分页边界即单次翻页 pass 内丢失），换成复合游标 + `_id` tiebreaker
// 与全仓其余 6 处分页同一实现（黄金 §G 已覆盖）。当前前端 Desk.vue 不带 cursor 调用（整刷第一页），线上不
// 可触达——这里修的是 API 契约层，回包形状 items/nextCursor/hasMore 对前端零变化。
export async function listQueue(ctx: Ctx): Promise<any> {
  const { db, data } = ctx
  const p = principal(ctx)
  const _ = db.command
  const filter: Record<string, any> = { status: p.isSuper ? _.in(['pending', 'escalated']) : 'pending' }
  const paged = await pageQuery(db, COLLECTIONS.csSession, filter, 'createdAt', data, LIST_LIMIT, 'asc')
  const items = paged.list.map((s) => ({
    sessionId: s._id,
    externalUserId: s.externalUserId || '',
    openKfId: s.openKfId || '',
    status: s.status,
    createdAt: Number(s.createdAt) || 0,
    updatedAt: Number(s.updatedAt) || 0,
  }))
  const nextCursor = paged.hasMore ? paged.nextCursor : undefined
  return reply(200, { ok: true, items, nextCursor })
}

// ── ② claimConversation：pending/escalated → active·绑 agentId·接待上限校验（B6.3）──
export async function claimConversation(ctx: Ctx): Promise<any> {
  const { db, data } = ctx
  const p = principal(ctx)
  if (!p.agentId) return reply(403, { ok: false, error: 'NO_AGENT' }) // 无认证坐席身份（不信前端·不认领）
  const sessionId = str(data && data.sessionId, 200)
  if (!sessionId) return reply(400, { ok: false, error: 'BAD_ARGS' })
  const s = await loadSession(db, sessionId)
  if (!s) return reply(404, { ok: false, error: 'NOT_FOUND' })
  // 接待上限（派生 activeCount<limit·B6.3）：满额拒（先查后转·TOCTOU 罕见·派生计数自愈）
  const [count, limit] = await Promise.all([activeCountFor(db, p.agentId), agentLimit(db, p.agentId)])
  if (count >= limit) return reply(200, { ok: false, error: 'AT_CAPACITY', limit })
  const now = Date.now()
  // pending/escalated → active（声明流转·原子幂等：并发已被接走则 moved=false）
  const r = await transition('csSession', sessionId, ['pending', 'escalated'], 'active', {
    agentId: p.agentId,
    claimedAt: now,
    updatedAt: now,
  })
  if (!r.moved) return reply(200, { ok: false, error: 'NOT_CLAIMABLE' }) // 非 pending/escalated（已 active/closed 或并发抢先）
  const fresh = await loadSession(db, sessionId)
  const openid = fresh ? await resolveOpenid(db, fresh) : null
  return reply(200, { ok: true, session: toView(fresh, openid) })
}

// ── ③ releaseConversation：active → pending 退回待接队列（坐席放手·清 agentId·activeCount 派生自动降）──
export async function releaseConversation(ctx: Ctx): Promise<any> {
  const { db, data } = ctx
  const p = principal(ctx)
  const sessionId = str(data && data.sessionId, 200)
  if (!sessionId) return reply(400, { ok: false, error: 'BAD_ARGS' })
  const sl = await scopedLoad(db, p, sessionId)
  if (sl.code) return reply(sl.code, { ok: false, error: sl.code === 404 ? 'NOT_FOUND' : 'FORBIDDEN' }) // 分配 scope：只放手自己 claim 的
  const s = sl.s
  const now = Date.now()
  const r = await transition('csSession', sessionId, ['active'], 'pending', {
    agentId: null, // 退回队列＝清归属（重回可认领态·activeCount 派生随 status 降）
    claimedAt: null,
    updatedAt: now,
  })
  if (!r.moved) return reply(200, { ok: false, error: 'NOT_ACTIVE' })
  return reply(200, { ok: true })
}

// ── ④ sendAgentMessage：坐席回复·经 cs/kfSend（48h 窗口内 send_msg）·出站落 conversations ──
// 越权发送面（§1.5·根因#3）双闸：① 分配 scope（ownsSession·外包只发自己 claim 的会话）；② 接待窗口
// （仅 active 态·防对已结束/未接会话越窗发·守卫 kf-send-server-gated 焊 sendAgentMessage 须过此两闸再发）。
// 发送经 cs/kfSend 服务端接缝（callFunction·isServerCall 放行服务端互调·不在此复制 token/sendMsg·接缝单点#12）。
export async function sendAgentMessage(ctx: Ctx): Promise<any> {
  const { db, cloud, data } = ctx
  const p = principal(ctx)
  const sessionId = str(data && data.sessionId, 200)
  const text = str(data && data.text, MAX_TEXT)
  if (!sessionId || !text) return reply(400, { ok: false, error: 'BAD_ARGS' })
  const sl = await scopedLoad(db, p, sessionId)
  if (sl.code) return reply(sl.code, { ok: false, error: sl.code === 404 ? 'NOT_FOUND' : 'FORBIDDEN' }) // 分配 scope
  const s = sl.s
  if (s.status !== 'active') return reply(200, { ok: false, error: 'NOT_ACTIVE' }) // 接待窗口：仅 active 可发
  if (!s.externalUserId || !s.openKfId) return reply(200, { ok: false, error: 'NO_CHANNEL' })
  // 经 cs/kfSend 主动发（服务端专用·48h 窗口内经微信客服 send_msg）；errcode 原样带回便于联调（同 kfSend）
  const res = await cloud
    .callFunction({ name: 'kfSend', data: { externalUserId: s.externalUserId, openKfId: s.openKfId, text } })
    .catch(() => null)
  const out = (res && res.result) || {}
  const errcode = Number(out.errcode) || 0
  // callFunction reject（res=null）或回包无 result（out={}）都不等于送达成功——
  // 必须先确认真有 result 才看 ok/errcode，否则 undefined!==false 会把整体失败误判为发出（B1·95018 同病根另一路径）。
  const sent = !!(res && res.result) && out.ok !== false && !errcode
  if (sent) {
    // 出站落 conversations（坐席回复归档·与 kfCallback archiveOutbound 同形·内联避跨域 import·铁律二）
    const openid = await resolveOpenid(db, s)
    await db
      .collection(COLLECTIONS.conversations)
      .add({
        data: {
          channel: CHANNEL,
          direction: 'out',
          openKfId: s.openKfId,
          externalUserId: s.externalUserId,
          openid: openid || '',
          msgtype: 'text',
          text,
          at: Date.now(),
          agentId: p.agentId, // 出站坐席身份（区别机器人自动回复·质检可溯）
        },
      })
      .catch(() => {}) // fail-soft：归档不反噬发送
    await db.collection(COLLECTIONS.csSession).doc(sessionId).update({ data: { updatedAt: Date.now() } }).catch(() => {})
    return reply(200, { ok: true, errcode: 0 })
  }
  // 发送失败 = ok:false（前端只看 ok·曾回 ok:true+errcode 被当成功→静默吞错+清输入框·95018 真机逼出·调试日志 AC）
  return reply(200, { ok: false, error: 'SEND_FAIL', errcode: errcode || -1 })
}

// ── ⑤ getThread：拉会话消息流·cursor 增量（前端轮询·分配 scope：外包只读自己 claim 的会话·根因#3/#7）──
export async function getThread(ctx: Ctx): Promise<any> {
  const { db, data } = ctx
  const p = principal(ctx)
  const sessionId = str(data && data.sessionId, 200)
  if (!sessionId) return reply(400, { ok: false, error: 'BAD_ARGS' })
  const sl = await scopedLoad(db, p, sessionId)
  if (sl.code) return reply(sl.code, { ok: false, error: sl.code === 404 ? 'NOT_FOUND' : 'FORBIDDEN' }) // 分配 scope
  const s = sl.s
  const _ = db.command
  // 增量游标：首拉（无 cursor）从会话建立**前 10 分钟**起（深审 F5——顾客点「转人工」之前打的字往往是真正的
  // 问题描述，坐席须看得到；10 分钟窗兼顾「不整段回溯该顾客历史会话」的 AD 语义）；cursor 有则取其后（轮询取新消息）。
  const PRE_CONTEXT_MS = 10 * 60_000
  const since = Math.max(Number(data && data.cursor) || 0, (Number(s.createdAt) || 0) - PRE_CONTEXT_MS - 1)
  const res = await db
    .collection(COLLECTIONS.conversations)
    .where({ externalUserId: s.externalUserId || '', openKfId: s.openKfId || '', at: _.gt(since) })
    .orderBy('at', 'asc')
    .limit(THREAD_LIMIT + 1) // 多查一条判 hasMore（bounded·capacity-reads-bounded）
    .get()
    .catch(() => ({ data: [] }))
  const raw: any[] = (res && res.data) || []
  const hasMore = raw.length > THREAD_LIMIT
  const list = hasMore ? raw.slice(0, THREAD_LIMIT) : raw
  const messages = list
    .filter((m) => (m.msgtype || '') !== 'event') // 平台事件非会话内容·存量档也不进坐席消息流（新档已在 archive 侧跳过）
    .map((m) => ({
      direction: m.direction === 'out' ? 'out' : 'in',
      msgtype: m.msgtype || '',
      text: m.text || '',
      at: Number(m.at) || 0,
      msgid: inboundMsgid(m._id), // bug sweep II L1：入站客户消息全局唯一 id（无则不带此字段·出站/历史档回退旧键去重）
    }))
  const nextCursor = list.length ? list[list.length - 1].at : Number(data && data.cursor) || undefined
  const openid = await resolveOpenid(db, s)
  return reply(200, { ok: true, session: toView(s, openid), messages, nextCursor })
}

// ── ⑥ setAgentStatus：坐席切在线/示忙/离线（写 agentState·排队分配据此·B6.3）──
export async function setAgentStatus(ctx: Ctx): Promise<any> {
  const { db, data } = ctx
  const p = principal(ctx)
  if (!p.agentId) return reply(403, { ok: false, error: 'NO_AGENT' })
  const status = AGENT_STATUS.includes(String(data && data.status) as any) ? String(data.status) : ''
  if (!status) return reply(400, { ok: false, error: 'BAD_ARGS' })
  const limit = await agentLimit(db, p.agentId) // 保留已配上限（首次建 doc 用默认）
  // doc(agentId).set({data}) 的 data 不含 _id（_id 由 doc 指定·真 sdk 约束·根因#8）
  // 写失败不再吞（P1·bug 清除战役II F2）：原 .catch(()=>{}) 后恒 ok:true——前端 Desk 的 confirmedStatus
  // 锚完全信任 r.ok，若写实际失败却回 ok:true，坐席在线状态与数据库脱节（排队分配据此、悄悄错误）。
  const err = await db
    .collection(COLLECTIONS.agentState)
    .doc(p.agentId)
    .set({ data: { status, limit, updatedAt: Date.now() } })
    .then(() => null)
    .catch((e: any) => e || new Error('WRITE_FAIL'))
  if (err) {
    await notifyAlert('anomaly', 'setAgentStatus', 'WRITE_FAIL', { agentId: p.agentId })
    return reply(200, { ok: false, error: 'WRITE_FAIL' })
  }
  return reply(200, { ok: true })
}

// ── ⑦ escalateToMerchant：active → escalated·甩回商户超管（外包最小权只能升不能拍板·§1 定稿）──
export async function escalateToMerchant(ctx: Ctx): Promise<any> {
  const { db, data } = ctx
  const p = principal(ctx)
  const sessionId = str(data && data.sessionId, 200)
  if (!sessionId) return reply(400, { ok: false, error: 'BAD_ARGS' })
  const sl = await scopedLoad(db, p, sessionId)
  if (sl.code) return reply(sl.code, { ok: false, error: sl.code === 404 ? 'NOT_FOUND' : 'FORBIDDEN' }) // 分配 scope
  const s = sl.s // 分配 scope：只升自己 claim 的
  const now = Date.now()
  // active → escalated（保留 agentId＝记录谁升的·activeCount 派生随 status 降·商户可 claim 重接）
  const r = await transition('csSession', sessionId, ['active'], 'escalated', { updatedAt: now })
  if (!r.moved) return reply(200, { ok: false, error: 'NOT_ACTIVE' })
  // M⑦ 推送线·fail-soft：会话升级 → 推商户超管手机（其 wecomUserId 存 adminConfig 'auth' doc·超管在 /agent 队列可见 escalated）
  try {
    const boss = await db.collection('adminConfig').doc('auth').get().catch(() => null)
    const uid = boss && boss.data && boss.data.wecomUserId
    if (uid)
      await sendAgentCard(db, [String(uid)], {
        title: '会话已升级待处理',
        description: '外包坐席升级了一个会话，需要你处理。',
        url: AGENT_DESK_URL + '?session=' + sessionId,
      })
  } catch {
    /* fail-soft：推送不反噬升级 */
  }
  return reply(200, { ok: true })
}

// ── ⑧ closeConversation：pending/active/escalated → closed（终态·触 CSAT 评分气泡·会话结束）──
export async function closeConversation(ctx: Ctx): Promise<any> {
  const { db, cloud, data } = ctx
  const p = principal(ctx)
  const sessionId = str(data && data.sessionId, 200)
  if (!sessionId) return reply(400, { ok: false, error: 'BAD_ARGS' })
  const sl = await scopedLoad(db, p, sessionId)
  if (sl.code) return reply(sl.code, { ok: false, error: sl.code === 404 ? 'NOT_FOUND' : 'FORBIDDEN' }) // 分配 scope
  const s = sl.s // 分配 scope：pending 仅超管可关（外包非 owner 拒）
  const now = Date.now()
  const wasEngaged = s.status === 'active' || s.status === 'escalated' // 真人接待过→结束时发 CSAT 提示
  // pending/active/escalated → closed（终态·声明流转·幂等：已 closed 则 moved=false）
  const r = await transition('csSession', sessionId, ['pending', 'active', 'escalated'], 'closed', {
    updatedAt: now,
  })
  if (!r.moved) return reply(200, { ok: false, error: 'ALREADY_CLOSED' })
  // 触 CSAT（best-effort·fail-soft·仅接待过的会话·B4.3）。深审 F2/F6 闭环：
  //  - 立 `csatask:<euid>` 标记（48h·dispatch 收到纯数字 1-5 且有此标记才 recordCsat——「回复 1-5 分」的兑现·
  //    曾只发提示无人认自由文本数字＝评分链断·顾客照做收到根菜单分数丢失）；
  //  - 提示文字落 conversations 归档（质检回看得到「我们问了什么」·曾只有顾客的「5」没有我们的提问）。
  if (wasEngaged && s.externalUserId && s.openKfId) {
    const res = await cloud
      .callFunction({ name: 'kfSend', data: { externalUserId: s.externalUserId, openKfId: s.openKfId, text: CSAT_PROMPT } })
      .catch(() => null)
    const sent = !!(res && res.result && res.result.ok !== false && !Number(res.result.errcode))
    if (sent) {
      await db
        .collection(COLLECTIONS.kfState)
        .doc('csatask:' + s.externalUserId)
        .set({ data: { at: now } })
        .catch(() => {}) // fail-soft：标记失败只是这条评分收不到·不反噬关单
      await db
        .collection(COLLECTIONS.conversations)
        .add({
          data: {
            channel: CHANNEL,
            direction: 'out',
            openKfId: s.openKfId,
            externalUserId: s.externalUserId,
            openid: '',
            msgtype: 'text',
            text: CSAT_PROMPT,
            at: Date.now(),
            agentId: p.agentId, // 谁触发的结束（提示随关单发·可溯）
          },
        })
        .catch(() => {}) // fail-soft：归档不反噬关单
    }
  }
  return reply(200, { ok: true })
}

// ── ⑨ listMyActive：本坐席在接（active）会话（follow-up ②·刷新/重登后恢复在接·多会话切换）──
// 只回 agentId===认证主体 的 active 会话（天然 scoped·非批量导出面）；bounded（接待上限本就 ≤limit·仍封顶防漂）。
export async function listMyActive(ctx: Ctx): Promise<any> {
  const { db, data } = ctx
  const p = principal(ctx)
  if (!p.agentId) return reply(403, { ok: false, error: 'NO_AGENT' })
  const { limit } = pageParams(data, LIST_LIMIT)
  const res = await db
    .collection(COLLECTIONS.csSession)
    .where({ agentId: p.agentId, status: 'active' })
    .orderBy('claimedAt', 'asc')
    .limit(limit)
    .get()
    .catch(() => ({ data: [] }))
  const rows: any[] = (res && res.data) || []
  const sessions = await Promise.all(rows.map(async (s) => toView(s, await resolveOpenid(db, s))))
  return reply(200, { ok: true, sessions })
}

// ── ⑩ getSessionCustomer360：按会话看对应客户 360（follow-up ①·外包唯一 360 读路径·§1.5 双闸）──
// RBAC 收窄后外包无 customer:view、直调 getCustomer360 已 403（防批量导出）——外包看 360 只能走本 scoped 路径：
// ① 分配 scope（scopedLoad→assertOwnedByAgent·只看自己 claim 的会话·超管数据控制者 bypass）；
// ② 数据共享同意闸（assertDataShareConsent·客户未同意第三方访问即拒·fail-closed·读侧真实消费者·B3.3）。
// 留痕：FORCE_AUDIT 含本 action（^get 被 shouldAudit 跳过·破例强制留痕·守卫 cs-360-read-audited）。
export async function getSessionCustomer360(ctx: Ctx): Promise<any> {
  const { db, data } = ctx
  const p = principal(ctx)
  const sessionId = str(data && data.sessionId, 200)
  if (!sessionId) return reply(400, { ok: false, error: 'BAD_ARGS' })
  const sl = await scopedLoad(db, p, sessionId)
  if (sl.code) return reply(sl.code, { ok: false, error: sl.code === 404 ? 'NOT_FOUND' : 'FORBIDDEN' }) // 分配 scope
  const s = sl.s
  const openid = await resolveOpenid(db, s)
  if (!openid) return reply(200, { ok: false, error: 'NO_BRIDGE' }) // 身份桥接未建（kfIdentity 无映射）·如实回·前端有提示
  if (!p.isSuper) {
    // 数据共享同意（§1.5·B3.3·根因#3 fail-closed）：外包（第三方受托客服）看客户 360 前客户须已同意；
    // 超管＝商户本人＝数据控制者，走现有隐私政策覆盖、不经本闸（csAccess 头注口径）。
    const consent = await assertDataShareConsent(db, openid)
    if (!consent.ok) return reply(403, { ok: false, error: 'NO_CONSENT' })
  }
  const result = await assembleCustomer360(db, openid)
  return reply(200, { ok: true, ...result })
}

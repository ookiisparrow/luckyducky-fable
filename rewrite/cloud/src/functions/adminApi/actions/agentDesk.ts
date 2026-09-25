import { reply, type Ctx } from '../lib'
import {
  transition,
  pageParams,
  pageQuery,
  assertOwnedByAgent,
  assertDataShareConsent,
  sendAgentCard,
  AGENT_DESK_URL,
  notifyAlert,
  getTempUrl,
  kfSendText,
  kfFetchMedia,
  getDocOrNull,
  str,
  err,
} from '../../../kit'
import { COLLECTIONS, ERR, AGENT_STATUS } from '@ldrw/shared'
import { assembleCustomer360 } from '../customer360/orchestrator'

// 承面 C 外包会话工作台·坐席台后端（B6.1–6.3·板块#12）。实现 shared/csAgentDesk.ts 契约的 8 个 action：
//   listQueue / claimConversation / releaseConversation / sendAgentMessage / getThread /
//   setAgentStatus / escalateToMerchant / closeConversation。
//
// 落点＝adminApi actions（复用口令闸/checkKey/ACTION_CAPS 能力闸）。均须 cap `agent:handle`（外包最小权·§1 定稿·
// 根因#3）——wire 在 adminApi/index.ts ACTION_CAPS + lib.ts ROLES.outsourced（与本文件同批落·不空守）。
//
// 信任边界（§1.5·根因#3 不信前端）：坐席身份 `agentId` 一律取自 checkKey 解析的**认证主体**（Ctx.agentId，
// 非 data 里前端传的）——防冒名认领/发消息。分配 scope：外包只能读/操作**自己 claim 的会话**（scopedSession →
// kit assertOwnedByAgent·超管 '*' 全量）。
//
// 状态流转一律走 kit `transition('csSession', …)`（合法流转单源 shared/cs.spec.ts·守卫 rw-status-transitions-declared
// 对账·私自越流转即红·根因#2）；一次性副作用绑首次转移（transition moved===true·天然幂等·根因#1）。
// 读路径 bounded（cursor/limit·根因#7）。发送经 kit 直连收口（2026-07-23 拓扑收编批·
// 17→13·原 cs/kfSend 独立函数收编进 kit/wecom.ts kfSendText，不再有跨函数 callFunction 接缝）。

const LIST_LIMIT = 20 // 待接队列默认页大小（bounded）
const THREAD_LIMIT = 50 // 会话消息流默认页大小（bounded）
const TIE_GROUP_CAP = 500 // 整页同值退化时的补查上限（纵深防御·真实客服单秒消息数远小于此·超过即真异常）
const MAX_TEXT = 2000 // 坐席回复文本上限（防超长入库/发送）
const DEFAULT_AGENT_LIMIT = 5 // 默认接待上限（agentState.limit 未配时）
const CHANNEL = 'wxkf' // 出站归档 channel（与 kfCallback archiveOutbound 同口径·多承面区分位）
// 会话结束满意度提示（触 CSAT·契约 closeConversation「触评分气泡」）：结束时最佳努力发给顾客，
// 顾客回复 1-5 由 cs/kfCallback dispatch recordCsat 归档（已在·B4.3）——本处只发提示、不自己写 csat。
const CSAT_PROMPT = '感谢你的咨询～这次服务还满意吗？回复 1-5 分帮我们改进（5 分最满意）🙏'

// 认证主体（根因#3 不信前端）：agentId＝checkKey 解析的账号 _id（外包账号 adminConfig._id / 超管 'admin'），
// 经 adminApi/index.ts 分发处贯入 Ctx（非 data 传入）。isSuper＝caps 含 '*'（商户超管·可读/操作全量会话）。
function principal(ctx: Ctx): { agentId: string; isSuper: boolean } {
  const agentId = String(ctx.agentId || '')
  const caps: string[] = Array.isArray(ctx.caps) ? ctx.caps : []
  return { agentId, isSuper: caps.includes('*') }
}

// 按会话操作的统一开头：取 sessionId（缺→400）+ 分配 scope + 载入会话（§1.5·根因#3·防批量导出）。
// 超管全量（loadSession）；外包经 kit 单源闸 assertOwnedByAgent（会话须存在且 agentId===本坐席·fail-closed·
// 单源 kit/csAccess·超管 bypass 留在这里·避双读）。拒绝时 deny＝要回的 reply：404 会话不存在；403 非本坐席 claim。
async function scopedSession(ctx: Ctx): Promise<{ deny: any } | { p: { agentId: string; isSuper: boolean }; sessionId: string; s: any }> {
  const p = principal(ctx)
  const sessionId = str(ctx.data && ctx.data.sessionId, 200)
  if (!sessionId) return { deny: reply(400, { ok: false, error: ERR.BAD_ARGS }) }
  if (p.isSuper) {
    const s = await loadSession(ctx.db, sessionId)
    return s ? { p, sessionId, s } : { deny: reply(404, { ok: false, error: ERR.NOT_FOUND }) }
  }
  const sc = await assertOwnedByAgent(ctx.db, p.agentId, sessionId)
  if (sc.ok) return { p, sessionId, s: sc.session }
  return { deny: sc.error === 'NO_SESSION' ? reply(404, { ok: false, error: ERR.NOT_FOUND }) : reply(403, { ok: false, error: ERR.FORBIDDEN }) }
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

// 坐席接待上限（agentState.limit·未配回默认）。读失败上抛——当成「未配」会让 setAgentStatus 把已配上限覆盖成默认值。
async function agentLimit(db: any, agentId: string): Promise<number> {
  const st = await getDocOrNull(db.collection(COLLECTIONS.agentState).doc(agentId))
  const lim = st ? Number(st.limit) : 0
  return lim && lim > 0 ? lim : DEFAULT_AGENT_LIMIT
}

// 坐席当前在接会话数（**派生**·防计数漂移·根因#8 桩≠真里的 inc 也不复现）：直接 count 本坐席 active 会话，
// 不维护 agentState.activeCount 手写计数器（claim/release/close/escalate 后自动准确·无 TOCTOU 漂移）。
// count 失败返 null（不当 0）——调用方 fail-closed，避免席位被超领。
async function activeCountFor(db: any, agentId: string): Promise<number | null> {
  const r = await db.collection(COLLECTIONS.csSession).where({ agentId, status: 'active' }).count().catch(() => null)
  if (!r) return null
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

// 读一条会话：真无档返 null；读失败上抛（不当「没有」·根因#14）。
const loadSession = (db: any, sessionId: string): Promise<any | null> => getDocOrNull(db.collection(COLLECTIONS.csSession).doc(sessionId))

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
  if (!p.agentId) return reply(403, { ok: false, error: ERR.NO_AGENT }) // 无认证坐席身份（不信前端·不认领）
  const sessionId = str(data && data.sessionId, 200)
  if (!sessionId) return reply(400, { ok: false, error: ERR.BAD_ARGS })
  const s = await loadSession(db, sessionId)
  if (!s) return reply(404, err('NOT_FOUND'))
  // escalated 会话仅超管可认领（listQueue/escalateToMerchant 头注设计意图：外包最小权"只能升不能拍板"，
  // 甩给商户超管的会话"只有商户能看见/重接"）。escalateToMerchant 转态刻意保留原 agentId，
  // 外包坐席在 escalated 态下仍 agentId===自己——若只靠 listQueue 过滤（不含 escalated）当"权限"，
  // 发起升级的坐席（或重放其令牌者）可直接带 sessionId 重放 claimConversation 把会话抢回，绕开商户复核。
  // 服务端强制：非超管遇 escalated 直接拒（不进 transition），不信"UI 看不见=真拿不到"。
  if (s.status === 'escalated' && !p.isSuper) return reply(403, err('ESCALATED_SUPER_ONLY'))
  // 接待上限（派生 activeCount<limit·B6.3）：满额拒（先查后转·TOCTOU 罕见·派生计数自愈）
  // 超管豁免（P2·escalateToMerchant 头注设计意图：外包甩单靠超管兜底——若超管本人也受同一上限
  // 约束、又没有调高 limit 的入口，外包升级上来的会话在超管已达默认上限时会永久无人能接，
  // 跟"甩给超管兜底"的设计意图矛盾）：isSuper 直接放行，不查 activeCountFor/agentLimit。
  if (!p.isSuper) {
    const [count, limit] = await Promise.all([activeCountFor(db, p.agentId), agentLimit(db, p.agentId)])
    if (count == null) return reply(200, { ok: false, error: ERR.WRITE_FAIL })
    if (count >= limit) return reply(200, err('AT_CAPACITY', { limit }))
  }
  const now = Date.now()
  const patch = { agentId: p.agentId, claimedAt: now, updatedAt: now }
  // pending/escalated → active（声明流转·原子幂等：并发已被接走则 moved=false）
  const r = await transition(COLLECTIONS.csSession, sessionId, ['pending', 'escalated'], 'active', patch)
  if (!r.moved) return reply(200, { ok: false, error: ERR.NOT_CLAIMABLE }) // 非 pending/escalated（已 active/closed 或并发抢先）
  // 回包＝流转前文档 + 本次写入（字段全已知）：不重读——重读抛错会让已成功的认领回 500
  const claimed = { ...r.doc, ...patch, status: 'active' }
  return reply(200, { ok: true, session: toView(claimed, await resolveOpenid(db, claimed)) })
}

// ── ③ releaseConversation：active → pending 退回待接队列（坐席放手·清 agentId·activeCount 派生自动降）──
export async function releaseConversation(ctx: Ctx): Promise<any> {
  const g = await scopedSession(ctx) // 分配 scope：只放手自己 claim 的
  if ('deny' in g) return g.deny
  const { sessionId } = g
  const now = Date.now()
  const r = await transition(COLLECTIONS.csSession, sessionId, ['active'], 'pending', {
    agentId: null, // 退回队列＝清归属（重回可认领态·activeCount 派生随 status 降）
    claimedAt: null,
    updatedAt: now,
  })
  if (!r.moved) return reply(200, { ok: false, error: ERR.NOT_ACTIVE })
  return reply(200, { ok: true })
}

// ── ④ sendAgentMessage：坐席回复·经 kit kfSendText（48h 窗口内 send_msg）·出站落 conversations ──
// 越权发送面（§1.5·根因#3）双闸：① 分配 scope（scopedSession → assertOwnedByAgent·外包只发自己 claim 的会话）；
// ② 接待窗口（仅 active 态·防对已结束/未接会话越窗发）。
// 发送经 kit 直连收口（2026-07-23 拓扑收编批·17→13）——原 cs/kfSend 独立函数已收编进 kit/wecom.ts，
// 不再有跨函数 callFunction 接缝；.catch(() => null) 保留为兜底（助手正常契约不抛网络外错误，
// 但网络层意外异常仍不该反噬发送流程失败判定，同 B1 fail-soft 精神）。
export async function sendAgentMessage(ctx: Ctx): Promise<any> {
  const { db, data } = ctx
  const text = str(data && data.text, MAX_TEXT)
  if (!text) return reply(400, { ok: false, error: ERR.BAD_ARGS })
  const g = await scopedSession(ctx)
  if ('deny' in g) return g.deny
  const { p, sessionId, s } = g
  if (s.status !== 'active') return reply(200, { ok: false, error: ERR.NOT_ACTIVE }) // 接待窗口：仅 active 可发
  if (!s.externalUserId || !s.openKfId) return reply(200, { ok: false, error: ERR.NO_CHANNEL })
  // 经 kit 直连主动发（48h 窗口内经微信客服 send_msg）；errcode 原样带回便于联调
  const out: any = await kfSendText({ externalUserId: s.externalUserId, openKfId: s.openKfId, text }).catch(() => null)
  const errcode = Number(out?.errcode) || 0
  // 助手异常（out=null）或未过校验闸（ok:false，如未配置/取 token 失败）都不等于送达成功——
  // 必须先确认真有返回且 ok 未被判 false 才看 errcode，否则 undefined!==false 会把整体失败误判为发出（B1·95018 同病根另一路径）。
  const sent = !!out && out.ok !== false && !errcode
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
  return reply(200, { ok: false, error: ERR.SEND_FAIL, errcode: errcode || -1 })
}

// ── ⑤ getThread：拉会话消息流·cursor 增量（前端轮询·分配 scope：外包只读自己 claim 的会话·根因#3/#7）──
//
// 边界 tie-breaker（P1 bug sweep 批B·同一秒多条消息永久漏读）：kfCallback/archive.ts 的 `at` 精度只到秒
// （`send_time*1000`），单会话内同秒多条消息是常态。原实现只按单字段 `at: _.gt(since)` 判定增量，若某次
// 轮询恰好把分页截断点切在「同 at 值」的中间（如 3 条同 at 消息只查到前 2 条），`nextCursor` 会取到这个被
// 撞点的 at 值，下一轮 `at > nextCursor`（严格大于）会把同值的剩余消息永久排除在外——不是"暂时看不到"，
// 是再也不会被任何一次轮询命中。
//
// 不直接复用 kit `pageQuery` 的复合游标 `{v,id}` 方案：pageQuery 的 nextCursor 是对象形状，而 getThread
// 的 wire 契约（`data.cursor` / 回包 `nextCursor`）是纯数字——前端 `rewrite/agent/src/lib/desk.ts`
// `advanceCursor(current:number, next)` 对非数字 next 直接判 NaN 丢弃、cursor 冻结不前进（agent/tests/desk.test.ts
// 锁死此数字语义）。把 nextCursor 换成对象会在没有配套改前端的情况下让轮询整体卡死
// （比原 bug 更坏：原 bug 只丢同值尾部，改坏后连后续所有消息都拉不到），代价远大于收益，故不硬套。
// 改用等价但契约不变的手写方案——「整组 tie 要么整批进本页、要么整批留到下一轮」：轮询语义天然容许
// "下一轮把上一轮没发的整批重新查一遍再发全"（不像分页 UI 必须精确衔接下一页、少一条都不行），
// 所以不需要 id 级别的游标去分辨"组内哪些已发过"——只要保证 cursor 永远只推进到"已完整交付"的
// 最后一个 at 值，被延后的整组下一轮 `at > cursor` 必然完整落在查询范围内，不丢不重。
// 查询另加 `orderBy('_id')` 兜底同值内的稳定次序（避免同一批读因排序不确定而使边界判定在不同轮询间漂移）。
export async function getThread(ctx: Ctx): Promise<any> {
  const { db, data } = ctx
  const g = await scopedSession(ctx)
  if ('deny' in g) return g.deny
  const { sessionId, s } = g
  // 身份桥接读与消息查询互不依赖，先发出与之并行（轮询热路径少一个串行往返）；resolveOpenid 内部已吞读错、不会 reject。
  const openidP = resolveOpenid(db, s)
  const _ = db.command
  // 增量游标：首拉（无 cursor）从会话建立**前 10 分钟**起（深审 F5——顾客点「转人工」之前打的字往往是真正的
  // 问题描述，坐席须看得到；10 分钟窗兼顾「不整段回溯该顾客历史会话」的 AD 语义）；cursor 有则取其后（轮询取新消息）。
  const PRE_CONTEXT_MS = 10 * 60_000
  // 合流取舍（2026-07-13·mp-7fixes 同步 PR#16→main）：本函数被 #16（深审·GRACE_MS 游标回退窗）与 main（PR#20 批B·
  // tie-group 补查）各自独立重写、解同一「同秒消息分页丢失」根因但契约互斥（GRACE_MS 靠客户端 msgid 去重容忍重取，
  // tie-group 契约要求服务端跨轮零重复）。承重并发代码不做行级硬拼——取 main tie-group 版为准。
  // 【#124·2026-08-24】晚到同秒根因在归档侧：kfCallback/archive.ts 入站 at 旧取 send_time*1000
  // （秒截断）与出站 Date.now() 毫秒混用同一条游标轴，晚到同秒顾客消息 at 落在已推进 cursor 之前被 at > since 永久
  // 跳过（P1）。已改入站 at＝统一入库时刻（毫秒·单调递增），晚到消息归档时刻必大于此前任何已交付 cursor——
  // tie-group 边界机制零改动、契约不变（等价测试见 app-admin6.test.ts）。
  const since = Math.max(Number(data && data.cursor) || 0, (Number(s.createdAt) || 0) - PRE_CONTEXT_MS - 1)
  const res = await db
    .collection(COLLECTIONS.conversations)
    .where({ externalUserId: s.externalUserId || '', openKfId: s.openKfId || '', at: _.gt(since) })
    .orderBy('at', 'asc')
    .orderBy('_id', 'asc') // 同 at 值内稳定次序（tie-breaker 边界判定跨轮询一致，不靠底层默认序）
    .limit(THREAD_LIMIT + 1) // 多查一条判 hasMore（bounded）
    .get() // 读失败上抛（网关 500）——不当空消息流（根因#14）
  const raw: any[] = (res && res.data) || []
  const hasMore = raw.length > THREAD_LIMIT
  let list = hasMore ? raw.slice(0, THREAD_LIMIT) : raw
  if (hasMore) {
    // 撞点保护：第一条被截掉的记录（raw[THREAD_LIMIT]）若与本页末条同 at 值，说明截断点切在同值组中间——
    // 把本页末尾属于该 at 值的记录整批退回（不发），留给下一轮 `at > cursor` 整批捞回。
    const boundaryAt = raw[THREAD_LIMIT].at
    while (list.length && list[list.length - 1].at === boundaryAt) list.pop()
    // 退化保护：整页 51 条全同一 at 值（单会话单秒消息数超页大小的极端突发，远超真实客服场景量级）——
    // 常规 tie-breaker 会把 list 清空、cursor 卡死永不前进。不能就此吐出原始截断页：那样第 51 条
    // 及后续同值消息会落在 `at > cursor`（cursor=boundaryAt）的排除范围外，永久漏读、且零信号
    // ——跟本函数本要根治的丢消息是同一种病，只是触发条件收窄成了"整页恰好同值"（评审 P2）。
    // 补救：单独窄查这个 at 值（sessionId 精确匹配·不受 THREAD_LIMIT 限制），把完整同值组拼回本页，
    // cursor 才能安全推进过 boundaryAt。补查加 TIE_GROUP_CAP 上限做纵深防御（不是无界读——真实
    // 客服场景单秒消息数远小于此，命中上限本身就是需要人工核实的异常）。
    if (!list.length) {
      const tieRes = await db
        .collection(COLLECTIONS.conversations)
        .where({ externalUserId: s.externalUserId || '', openKfId: s.openKfId || '', at: boundaryAt })
        .orderBy('_id', 'asc')
        .limit(TIE_GROUP_CAP)
        .get()
        .catch(() => ({ data: [] }))
      const tieRaw: any[] = (tieRes && tieRes.data) || []
      if (tieRaw.length && tieRaw.length < TIE_GROUP_CAP) {
        list = tieRaw // 补查拿全了该 at 值全部消息——整组拼进本次返回，cursor 可安全越过 boundaryAt
      } else {
        // 补查也拿不到，或该 at 值消息数达到/超过补查上限（理论上不该发生）——补查同样可能不完整，
        // 不能假装拿全了。留痕告警（动作类失败禁静默·根因#14）+ 退回原始截断页兜底（有限退化，不做无界拉取）。
        await notifyAlert('anomaly', 'getThread', 'TIE_GROUP_DEGRADED', { sessionId, at: boundaryAt, tieCount: tieRaw.length })
        list = raw.slice(0, THREAD_LIMIT)
      }
    }
  }
  const messages = list
    .filter((m) => (m.msgtype || '') !== 'event') // 平台事件非会话内容·存量档也不进坐席消息流（新档已在 archive 侧跳过）
    .map((m) => ({
      direction: m.direction === 'out' ? 'out' : 'in',
      msgtype: m.msgtype || '',
      text: m.text || '',
      at: Number(m.at) || 0,
      msgid: inboundMsgid(m._id), // bug sweep II L1：入站客户消息全局唯一 id（无则不带此字段·出站/历史档回退旧键去重）
      hasMedia: !!(m.mediaId || m.fileId), // B5：坐席台据此渲染图片气泡（未加载=mediaId·已加载过=fileId）
    }))
  const nextCursor = list.length ? list[list.length - 1].at : Number(data && data.cursor) || undefined
  return reply(200, { ok: true, session: toView(s, await openidP), messages, nextCursor })
}

// ── ⑤.5 getMediaUrl：顾客发图坐席可见（B5·图片消息下载延迟到坐席首次请求·平台接缝单点#12）──
// 双闸：① 分配 scope（scopedSession→assertOwnedByAgent·外包只能拉自己在接会话的图）；② 消息真属于本会话
// （防跨会话拉图——scope 闸只护「会话本身」，这里再核「消息-会话」对应关系：msgId 对应消息行须与本会话
// 同一 externalUserId+openKfId，不能借自己名下会话号偷看别会话的图）。
// 缓存命中（消息行已有 fileId·云存储缓存）直接换临时 URL，不重新下载；否则经 kit 直连收口（2026-07-23
// 拓扑收编批·17→13·原 cs/kfMedia 独立函数收编进 kit/wecom.ts kfFetchMedia）下载 media_id（3 天有效·
// 过期如实回 EXPIRED）→ uploadFile 落 cs-media/<msgId>（幂等：固定云路径，重复下载覆盖同路径无害）→ 回写
// fileId → 换临时 URL。下载/上传失败经 notifyAlert 留痕（动作类失败禁静默·根因#14）；不重试风暴（前端手动重试）。
export async function getMediaUrl(ctx: Ctx): Promise<any> {
  const { db, cloud, data } = ctx
  const msgId = str(data && data.msgId, 200)
  if (!msgId) return reply(400, { ok: false, error: ERR.BAD_ARGS })
  const g = await scopedSession(ctx)
  if ('deny' in g) return g.deny
  const { sessionId, s } = g
  const docId = INBOUND_ID_PREFIX + msgId
  const got = await db.collection(COLLECTIONS.conversations).doc(docId).get().catch(() => null)
  const row = got && got.data
  if (!row) return reply(404, { ok: false, error: ERR.MSG_NOT_FOUND })
  // 消息归属会话校验（防跨会话拉图）：非本会话的消息一律拒，即便调用者确实拥有 sessionId 本身
  if (String(row.externalUserId || '') !== String(s.externalUserId || '') || String(row.openKfId || '') !== String(s.openKfId || '')) {
    return reply(403, { ok: false, error: ERR.NOT_IN_SESSION })
  }
  // 缓存命中：已落云存储 → 直接换临时 URL，不再触发下载
  if (row.fileId) {
    const url = await getTempUrl(row.fileId)
    if (url) return reply(200, { ok: true, url, cached: true })
    await notifyAlert('anomaly', 'getMediaUrl', 'CACHED_URL_FAILED', { sessionId, msgId }) // 罕见：fileId 在但换不到 URL（云存储侧异常）
  }
  const mediaId = String(row.mediaId || '')
  if (!mediaId) return reply(200, { ok: false, error: ERR.NO_MEDIA }) // 非图片消息/未落 mediaId
  // 经 kit 直连下载（.catch(() => null) 兜底同 sendAgentMessage：助手正常契约不抛，网络层意外异常不反噬判定）
  const out: any = await kfFetchMedia(mediaId).catch(() => null)
  if (!out || out.ok === false) {
    if (out && out.expired) return reply(200, { ok: false, error: ERR.EXPIRED }) // media_id 3 天有效·如实语义
    await notifyAlert('anomaly', 'getMediaUrl', out ? 'MEDIA_DOWNLOAD_FAILED' : 'MEDIA_CALL_FAILED', { sessionId, msgId, errcode: out?.errcode || 0 })
    return reply(200, { ok: false, error: ERR.DOWNLOAD_FAILED })
  }
  let fileId: string
  try {
    // 直连收编后无需 base64 往返（同进程 Buffer 直传·跨函数 JSON 序列化约束已消失）
    const up = await cloud.uploadFile({ cloudPath: `cs-media/${msgId}`, fileContent: out.buffer })
    fileId = up.fileID
  } catch {
    await notifyAlert('anomaly', 'getMediaUrl', 'UPLOAD_FAILED', { sessionId, msgId })
    return reply(200, { ok: false, error: ERR.UPLOAD_FAILED })
  }
  await db.collection(COLLECTIONS.conversations).doc(docId).update({ data: { fileId } }).catch(() => {}) // fail-soft：回写失败不反噬本次返回，下次重下载兜底
  const url = await getTempUrl(fileId)
  if (!url) return reply(200, { ok: false, error: ERR.URL_FAILED })
  return reply(200, { ok: true, url, cached: false })
}

// ── ⑥ setAgentStatus：坐席切在线/示忙/离线（写 agentState·排队分配据此·B6.3）──
export async function setAgentStatus(ctx: Ctx): Promise<any> {
  const { db, data } = ctx
  const p = principal(ctx)
  if (!p.agentId) return reply(403, { ok: false, error: ERR.NO_AGENT })
  const status = AGENT_STATUS.includes(String(data && data.status) as any) ? String(data.status) : ''
  if (!status) return reply(400, { ok: false, error: ERR.BAD_ARGS })
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
    return reply(200, { ok: false, error: ERR.WRITE_FAIL })
  }
  return reply(200, { ok: true })
}

// ── ⑦ escalateToMerchant：active → escalated·甩回商户超管（外包最小权只能升不能拍板·§1 定稿）──
export async function escalateToMerchant(ctx: Ctx): Promise<any> {
  const { db } = ctx
  const g = await scopedSession(ctx) // 分配 scope：只升自己 claim 的
  if ('deny' in g) return g.deny
  const { sessionId } = g
  const now = Date.now()
  // active → escalated（保留 agentId＝记录谁升的·activeCount 派生随 status 降·商户可 claim 重接）
  const r = await transition(COLLECTIONS.csSession, sessionId, ['active'], 'escalated', { updatedAt: now })
  if (!r.moved) return reply(200, { ok: false, error: ERR.NOT_ACTIVE })
  // M⑦ 推送线·fail-soft：会话升级 → 推商户超管手机（其 wecomUserId 存 adminConfig 'auth' doc·超管在 /agent 队列可见 escalated）
  try {
    const boss = await db.collection(COLLECTIONS.adminConfig).doc('auth').get().catch(() => null)
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
  const { db } = ctx
  const g = await scopedSession(ctx) // 分配 scope：pending 仅超管可关（外包非 owner 拒）
  if ('deny' in g) return g.deny
  const { p, sessionId, s } = g
  const now = Date.now()
  const wasEngaged = s.status === 'active' || s.status === 'escalated' // 真人接待过→结束时发 CSAT 提示
  // pending/active/escalated → closed（终态·声明流转·幂等：已 closed 则 moved=false）
  const r = await transition(COLLECTIONS.csSession, sessionId, ['pending', 'active', 'escalated'], 'closed', {
    updatedAt: now,
  })
  if (!r.moved) return reply(200, { ok: false, error: ERR.ALREADY_CLOSED })
  // 触 CSAT（best-effort·fail-soft·仅接待过的会话·B4.3）。深审 F2/F6 闭环：
  //  - 立 `csatask:<euid>` 标记（48h·dispatch 收到纯数字 1-5 且有此标记才 recordCsat——「回复 1-5 分」的兑现·
  //    曾只发提示无人认自由文本数字＝评分链断·顾客照做收到根菜单分数丢失）；
  //  - 提示文字落 conversations 归档（质检回看得到「我们问了什么」·曾只有顾客的「5」没有我们的提问）。
  if (wasEngaged && s.externalUserId && s.openKfId) {
    // 经 kit 直连收口发提示（2026-07-23 拓扑收编批·17→13·原 cs/kfSend 独立函数已收编）
    const out: any = await kfSendText({ externalUserId: s.externalUserId, openKfId: s.openKfId, text: CSAT_PROMPT }).catch(() => null)
    const sent = !!(out && out.ok !== false && !Number(out.errcode))
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
  if (!p.agentId) return reply(403, { ok: false, error: ERR.NO_AGENT })
  const { limit } = pageParams(data, LIST_LIMIT)
  const res = await db
    .collection(COLLECTIONS.csSession)
    .where({ agentId: p.agentId, status: 'active' })
    .orderBy('claimedAt', 'asc')
    .limit(limit)
    .get() // 读失败上抛（网关 500）——不当「我在接」空列表（根因#14）
  const rows: any[] = (res && res.data) || []
  const sessions = await Promise.all(rows.map(async (s) => toView(s, await resolveOpenid(db, s))))
  return reply(200, { ok: true, sessions })
}

// ── ⑩ getSessionCustomer360：按会话看对应客户 360（follow-up ①·外包唯一 360 读路径·§1.5 双闸）──
// RBAC 收窄后外包无 customer:view、直调 getCustomer360 已 403（防批量导出）——外包看 360 只能走本 scoped 路径：
// ① 分配 scope（scopedSession→assertOwnedByAgent·只看自己 claim 的会话·超管数据控制者 bypass）；
// ② 数据共享同意闸（assertDataShareConsent·客户未同意第三方访问即拒·fail-closed·读侧真实消费者·B3.3）。
// 留痕：FORCE_AUDIT 含本 action（^get 被 shouldAudit 跳过·破例强制留痕）。
export async function getSessionCustomer360(ctx: Ctx): Promise<any> {
  const { db } = ctx
  const g = await scopedSession(ctx)
  if ('deny' in g) return g.deny
  const { p, s } = g
  const openid = await resolveOpenid(db, s)
  if (!openid) return reply(200, { ok: false, error: ERR.NO_BRIDGE }) // 身份桥接未建（kfIdentity 无映射）·如实回·前端有提示
  if (!p.isSuper) {
    // 数据共享同意（§1.5·B3.3·根因#3 fail-closed）：外包（第三方受托客服）看客户 360 前客户须已同意；
    // 超管＝商户本人＝数据控制者，走现有隐私政策覆盖、不经本闸（csAccess 头注口径）。
    const consent = await assertDataShareConsent(db, openid)
    if (!consent.ok) return reply(403, { ok: false, error: ERR.NO_CONSENT })
  }
  const result = await assembleCustomer360(db, openid)
  return reply(200, { ok: true, ...result })
}

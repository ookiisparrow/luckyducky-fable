import { reply, type Ctx } from '../lib'
import { runInspection, pageQuery, recordAnomaly, throttleHit, str } from '../../../kit'
import { COLLECTIONS } from '@ldrw/shared'

// 运行期观测·控制台数据层（批3·体检面板 + 异常账本·治病根#14 告警进人眼）：手动巡检 / 最新体检 / 异常列表 /
// 标记已处理。未登记 ACTION_CAPS→默认拒＝仅超管；写类（runInspect/resolveAnomaly）自动审计。**只读业务数据**：
// 只读 inspectRuns/anomalies 两 ops 集合 + 触发只读巡检，绝不改业务集合（同「只读看护」铁律）。

/** 立即巡检（手动触发一轮·同定时器 timers/inspect·写 inspectRuns + 红项落 anomaly + 高危推告警）。 */
export async function runInspect(_ctx: Ctx) {
  const run = await runInspection('manual')
  return reply(200, { ok: true, run })
}

/** 最新体检报告 + 未处理异常计数（体检面板首屏）。 */
export async function getInspectStatus({ db }: Ctx) {
  const _ = db.command
  const latest = await db
    .collection(COLLECTIONS.inspectRuns)
    .where({ startedAt: _.gt(0) }) // 排除 A5 心跳档（startedAt:0·非体检记录）·读侧意图显式、不靠排序碰巧（存量真巡检 startedAt 全 >0·零迁移）
    .orderBy('startedAt', 'desc')
    .limit(1)
    .get()
    .then((r: any) => (r.data && r.data[0]) || null)
    .catch(() => null)
  const openAnomalies = await db
    .collection(COLLECTIONS.anomalies)
    .where({ resolved: false })
    .count()
    .then((r: any) => r.total || 0)
    .catch(() => 0)
  return reply(200, { ok: true, latest, openAnomalies })
}

/** 异常账本列表（按 lastSeen 倒序·可筛 resolved/kind·有界分页·不封顶静默挤出）。
 *  total（N2·bug 清除战役 II 遗留）：同一 filter 上补 .count() 拿账本真实总数——不改分页语义
 *  （不封顶仍锁定，list 仍 ≤200），纯增量字段；.catch(()=>null) 读失败不砸主查询。 */
export async function listAnomalies({ db, data }: Ctx) {
  const d = data || {}
  const filter: any = {}
  if (d.resolved === true || d.resolved === false) filter.resolved = d.resolved
  if (d.kind) filter.kind = String(d.kind)
  const limit = Math.min(Number(d.limit) || 50, 200)
  const list = await db
    .collection(COLLECTIONS.anomalies)
    .where(filter)
    .orderBy('lastSeen', 'desc')
    .limit(limit)
    .get()
    .then((r: any) => r.data)
    .catch(() => [])
  const total = await db
    .collection(COLLECTIONS.anomalies)
    .where(filter)
    .count()
    .then((r: any) => (typeof r.total === 'number' ? r.total : null))
    .catch(() => null)
  return reply(200, { ok: true, list, limit, total })
}

/** 标记异常已处理（写·自动审计·resolvedBy 记真实操作者）。 */
export async function resolveAnomaly({ db, data, agentId }: Ctx) {
  const id = String((data && data.id) || '')
  if (!id) return reply(200, { ok: false, error: 'BAD_ARGS' })
  const r = await db
    .collection(COLLECTIONS.anomalies)
    .doc(id)
    .update({ data: { resolved: true, resolvedAt: Date.now(), resolvedBy: agentId || 'admin' } })
    .catch(() => ({ stats: { updated: 0 } }))
  return reply(200, { ok: !!(r.stats && r.stats.updated), id })
}

const AUDIT_DEFAULT_LIMIT = 30 // 审计日志默认页大小（同订单/售后体量·bounded·根因#7）

// 审计日志读出口（批 B6·操作审计#4·根因#3 信任边界可追溯）：kit/audit.ts::recordAudit 已全量写 auditLog，
// 此前唯一读路径是控制台裸翻数据库——本 action 补读出口。只读 auditLog（写侧单点仍在 kit/audit.ts，见
// 该文件头注 admin-actions-audited 守卫）。未登记 ACTION_CAPS→默认拒 admin:write＝仅超管（同 listAnomalies/
// getConfigChecklist 等「系统组」action 先例——不复用 customer:view，那是「客户是谁」越权面，这里是「谁动过
// 系统」，权限语义不同）。cursor 分页复用 kit/paging.ts pageQuery（同 listCsatEntries 样板，无新分页实现）。
//
// operator 精确匹配（trim+截 60 字符，同写侧落库长度）：进 pageQuery filter，非 cursorField，翻页不受影响。
// actionPrefix 前缀筛：页内 startsWith 过滤（同 searchConversations keyword 范式）——真前缀检索须真 sdk 索引，
// 先页内过滤；不影响 hasMore/nextCursor（发生在 hasMore 判定之后，可能出现「entries 为空但 hasMore 仍真」，
// 是刻意设计非 bug，前端消费须允许「本页无匹配、点加载更多继续翻」的语义）。
// [from,to) 含起不含止（同 listCsatEntries 口径）：
//   · to 走 pageQuery 原生 filter（`ts: _.lt(to)`）——desc 序下天然对续页自持。
//   · from 走「页后过滤 + 触界即收口」：同字段无法原生持续下限（见 kit/paging.ts 复合游标机制），一旦本页
//     出现被过滤掉的行即说明后续行只会更早，直接砍 hasMore/nextCursor，不再继续翻页。
export async function listAudit({ db, data }: Ctx) {
  const d = data || {}
  const _ = db.command
  const filter: Record<string, unknown> = {}
  const operator = String(d.operator || '').trim().slice(0, 60)
  if (operator) filter.operator = operator
  const toMs = Number(d.to)
  if (Number.isFinite(toMs)) filter.ts = _.lt(toMs)
  const paged = await pageQuery(db, COLLECTIONS.auditLog, filter, 'ts', d, AUDIT_DEFAULT_LIMIT)
  let list = paged.list
  let hasMore = paged.hasMore
  let nextCursor = paged.nextCursor
  const fromMs = Number(d.from)
  if (Number.isFinite(fromMs)) {
    const kept = list.filter((r: any) => (Number(r.ts) || 0) >= fromMs)
    if (kept.length < list.length) {
      // 本页已触到 from 下界——后续页只会更早，全部落在窗口外，就此收口不再续页
      hasMore = false
      nextCursor = null
    }
    list = kept
  }
  const actionPrefix = String(d.actionPrefix || '').trim()
  if (actionPrefix) list = list.filter((r: any) => String(r.action || '').startsWith(actionPrefix))
  const entries = list.map((r: any) => ({
    id: String(r._id || ''),
    action: String(r.action || ''),
    operator: String(r.operator || ''),
    ip: String(r.ip || ''),
    ok: r.ok === true,
    error: String(r.error || ''),
    summary: r.summary && typeof r.summary === 'object' ? r.summary : {}, // 原样透传：写侧 summarize 已剥敏感字段
    ts: Number(r.ts) || 0,
  }))
  return reply(200, { ok: true, entries, nextCursor, hasMore })
}

// web 前端错误上报（批 B7·治病根#14 client-error 通道 web 半边）：admin/agent 两端 errorReporter.ts（三件套
// window.onerror/unhandledrejection/Vue errorHandler）唯一落口。会话内客户端已去重 + 封顶（MAX_REPORTS=20，
// 见两端 lib/errorReporter.ts）——此处服务端二级节流（按 agentId，10 分钟窗 20 次，同一圆整值降认知负担）
// 防绕过前端节流的重放/多开。写入走既有 recordAnomaly('client-error',...) 通道（kind 早已在 mp 端启用，见
// rewrite/mp/app.ts::reportClientError→trackEvent('client_error',...)——本 action 是完全不同的函数/路径，
// 与 mp 那条本地函数同名不冲突）。**不**过 shouldAudit（kit/audit.ts 已排除）：高频遥测非操作审计对象。
const CLIENT_ERROR_THROTTLE = { max: 20, windowMs: 10 * 60_000 }
const CLIENT_ERROR_CODE: Record<string, string> = { admin: 'ADMIN_JS_ERROR', agent: 'AGENT_JS_ERROR' }

// 短哈希指纹（djb2 风格滚动哈希→base36，纯 ASCII 输出）：避开 shared/observability.ts::anomalyFingerprint
// 的 `[^a-zA-Z0-9_.-]` 白名单剥空坑——若直接把中文报错消息整段当 fp scope，非 ASCII 字符会被整段剥空，
// 所有中文报错会坍缩成同一条指纹（mp 侧现有实现 `fp:msg.slice(0,60)` 潜藏此坑，见 docs/待办与债.md；
// 本批不碰 mp，仅新写的这条 action 用字符集无关的短哈希避开同一坑）。指纹用途是去重分组，非安全哈希，
// 碰撞可接受（同码同源不同措辞的报错折成一条属可接受的粗粒度）。
function hashSig(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = (h * 33) ^ s.charCodeAt(i)
    h |= 0
  }
  return (h >>> 0).toString(36)
}

/** web 前端错误上报唯一落口（admin/agent 两端共用）：节流→校验→落 anomalies。fail-soft 由 recordAnomaly 自身承担。 */
export async function reportClientError({ data, agentId }: Ctx) {
  const over = await throttleHit('clientError:' + (agentId || 'anon'), CLIENT_ERROR_THROTTLE)
  if (over) return reply(200, { ok: true, dropped: true }) // 节流丢弃不算错误，前端不必重试
  const d = data || {}
  const msg = str(d.msg, 500)
  if (!msg) return reply(200, { ok: false, error: 'BAD_ARGS' })
  const source = d.source === 'admin' || d.source === 'agent' ? d.source : 'unknown'
  const page = str(d.page, 200)
  await recordAnomaly('client-error', CLIENT_ERROR_CODE[source] || 'WEB_JS_ERROR', { fp: hashSig(msg), source, page, msg, agentId: agentId || '' }, 'low')
  return reply(200, { ok: true })
}

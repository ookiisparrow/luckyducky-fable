import { reply, type Ctx } from '../lib'
import { runInspection } from '../../../kit'
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
  const latest = await db
    .collection(COLLECTIONS.inspectRuns)
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

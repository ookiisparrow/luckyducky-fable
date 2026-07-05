import { getDb } from './db'
import { alert } from './observe'
import { COLLECTIONS, anomalyFingerprint, type AnomalyKind, type AnomalySeverity } from '@ldrw/shared'

// bug 收集器地基（运行期观测·防治静默 bug·守卫 rw-anomaly-record-golden）：四路来源（服务端异常/
// 业务不变量违反/关键流程失败/客户端错误）统一落库口。北极星＝把没抛异常/没告警/没人投诉的失败留成痕。
// 三条铁律：① 指纹去重（确定性 _id·根因#1 撞键即幂等）——同一 bug 反复发只累加 count 不刷屏；
// ② fail-soft——绝不抛错（可观测性不反噬主流程，同 recordAudit）；③ 对业务集合零写入——只写 anomalies
// （「现在就只读看护线上」的安全铁律）。高危去重感知告警：仅首次出现推 notifyAlert，重复不刷（防告警疲劳）。

// 敏感键（比审计更严：异常账本可广读，PII 也剥）——绝不入库（安全·CLAUDE §7）。
const SENSITIVE = new Set([
  'openid',
  'unionid',
  'phone',
  'mobile',
  'key',
  'password',
  'pwd',
  'secret',
  'token',
  'alertWebhook',
  'webhook',
])

// 非敏感上下文：剥凭证/PII、对象只留形状、长串截断（防泄密 + 防膨胀）。绝不 JSON 化整个 ctx（防循环引用抛错）。
function sanitizeCtx(ctx: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!ctx || typeof ctx !== 'object') return out
  for (const [k, v] of Object.entries(ctx)) {
    if (SENSITIVE.has(k) || v == null) continue
    out[k] = typeof v === 'object' ? (Array.isArray(v) ? `[${v.length}]` : '{…}') : String(v).slice(0, 120)
  }
  return out
}

/**
 * 记一条异常/不符合预期的行为；**fail-soft——绝不抛错**（可观测性不反噬主流程）。
 * @param ctx 非敏感上下文；可带 `fp`（如 orderId）细分去重键——「知道是哪些订单卡了」而非只知有卡单。
 */
export async function recordAnomaly(
  kind: AnomalyKind,
  code: string,
  ctx: Record<string, unknown> = {},
  severity: AnomalySeverity = 'low',
  opts: { alertOnHigh?: boolean } = {}, // notifyAlert 桥接进来时 alertOnHigh:false（它已自行告警·不重复·防递归）
): Promise<void> {
  try {
    const sctx = sanitizeCtx(ctx)
    const scope = typeof ctx.fp === 'string' ? ctx.fp : undefined
    const fp = anomalyFingerprint(kind, code, scope)
    const now = Date.now()
    const db = getDb()
    const _ = db.command
    const coll = db.collection(COLLECTIONS.anomalies)
    // update-first 幂等：已存在→原子自增 count（去重）；不存在→建档。
    const bumped = await coll.doc(fp).update({ data: { count: _.inc(1), lastSeen: now } })
    let isNew = false
    if (!bumped || !bumped.stats || bumped.stats.updated === 0) {
      try {
        await coll.add({
          data: { _id: fp, kind, code, severity, ctx: sctx, count: 1, firstSeen: now, lastSeen: now, resolved: false },
        })
        isNew = true
      } catch {
        // 撞号=并发方在 update 后 add 前抢先建档 → 补一次自增（天然幂等）
        await coll.doc(fp).update({ data: { count: _.inc(1), lastSeen: now } })
      }
    }
    // 高危去重感知告警：仅首见推送、重复不刷（防告警疲劳）。经 alert 直发（不走 notifyAlert·防桥接递归）；
    // notifyAlert 桥接进来时 alertOnHigh:false（它已自行告警过·不重复推、不再落第二条）。
    if (isNew && severity === 'high' && opts.alertOnHigh !== false) alert('anomaly', kind, code, { fp, ...sctx })
  } catch {
    /* fail-soft：可观测性绝不反噬主流程 */
  }
}

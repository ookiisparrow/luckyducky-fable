/**
 * 运行期可观测契约（bug 收集器 + 巡检机地基）。
 * 北极星＝防治静默 bug：把没抛异常、没告警、没人投诉、只是悄悄错了/悄悄卡住的失败留成痕。
 * 不依赖 AI——四路来源的确定性落库结构，控制台按此形状读。
 */

/** 异常来源四路（用户拍板全采集）：服务端异常 / 业务不变量违反 / 关键流程失败 / 客户端错误。 */
export type AnomalyKind = 'server-exception' | 'invariant-violation' | 'flow-failure' | 'client-error'

/** 严重度（用户拍板「记录 + 高危主动告警」）：high 首次出现即推告警、low 只落库。 */
export type AnomalySeverity = 'low' | 'high'

/** bug 账本一条（确定性 _id=指纹·同一 bug 反复发只累加 count 不刷屏）。ctx 已剥敏感、只留非敏感标识。 */
export interface AnomalyRecord {
  _id: string // 指纹（anomalyFingerprint 产出）
  kind: AnomalyKind
  code: string // 定型码/短标识（如 MONEY_NOT_CONSERVED / STUCK_ORDER）
  severity: AnomalySeverity
  ctx: Record<string, unknown> // 非敏感上下文（sanitizeCtx 剥 openid/口令/凭证后）
  count: number // 出现次数（去重累加）
  firstSeen: number // 首次出现 ms
  lastSeen: number // 最近出现 ms
  resolved: boolean // 是否已在控制台标记处理
  resolvedAt?: number
  resolvedBy?: string
}

/**
 * 指纹＝去重键（确定性 _id·根因#1 撞键即幂等）。默认按 kind+code 归类；
 * 传 scope（如 orderId）则按受影响实体细分——「知道是哪些订单卡了」而非只知有卡单。
 * 结果限安全字符 + 截断 120，作合法 doc _id。
 */
export function anomalyFingerprint(kind: AnomalyKind, code: string, scope?: string): string {
  const raw = `anom_${kind}_${code}${scope ? '_' + scope : ''}`
  return raw.replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 120)
}

// —— 巡检机（inspect·批2·不依赖 AI 的定时/手动体检）——

/** 检查分层：基建存活 / 业务不变量（用户拍板「两层都要」）。 */
export type CheckLayer = 'infra' | 'invariant'

/** 检查结果灯：绿=过·黄=可疑降级·红=违反。 */
export type CheckStatus = 'green' | 'yellow' | 'red'

/** 一条检查结果（控制台体检面板按此渲染红绿灯·批3 用）。 */
export interface CheckResult {
  id: string // 检查 id（db-reachable / money-conserved / stuck-order …）
  title: string // 大白话标题
  layer: CheckLayer
  status: CheckStatus
  detail: string // 结论一句话
  severity: AnomalySeverity // 红时落 anomaly 的严重度
  count?: number // 命中的问题实体数（不变量类）
  samples?: string[] // 样本 id（有界·非 PII）
  scanned?: number // 实际扫描条数（防静默截断·no silent caps）
  capped?: boolean // 扫描是否触顶（有界·触顶显式标·不假装扫全了）
}

/** 一次巡检运行（inspectRuns 集合·体检报告）。 */
export interface InspectRunRecord {
  _id: string
  startedAt: number
  finishedAt: number
  trigger: 'timer' | 'manual'
  results: CheckResult[]
  summary: { green: number; yellow: number; red: number }
}

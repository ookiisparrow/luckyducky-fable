// 运行期观测组 api（薄封装·经 client.post 带会话令牌）——体检面板 + 异常账本（治病根#14 告警进人眼）
// 回包类型取 @ldrw/shared 的后台契约
import type { AdminInspectRun, AdminInspectStatus, AdminAnomalies, AdminAnomalyResolved, AdminAuditPage } from '@ldrw/shared'
import { typedPost } from './index'

/** 立即巡检（手动触发一轮·同定时器）。 */
export const runInspect = () => typedPost<AdminInspectRun>('runInspect')
/** 最新体检报告 + 未处理异常计数。 */
export const getInspectStatus = () => typedPost<AdminInspectStatus>('getInspectStatus')
/** 异常账本列表（可筛 resolved/kind·有界）。 */
export const listAnomalies = (opts: { resolved?: boolean; kind?: string; limit?: number } = {}) =>
  typedPost<AdminAnomalies>('listAnomalies', opts)
/** 标记异常已处理。 */
export const resolveAnomaly = (id: string) => typedPost<AdminAnomalyResolved>('resolveAnomaly', { id })
/** 审计日志（操作审计读出口·cursor 分页·仅超管）：谁在何时做了什么操作。 */
export const listAudit = (
  opts: { cursor?: unknown; limit?: number; operator?: string; actionPrefix?: string; from?: number; to?: number } = {},
) => typedPost<AdminAuditPage>('listAudit', opts)

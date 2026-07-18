// 运行期观测组 api（薄封装·经 client.post 带会话令牌）——体检面板 + 异常账本（批3·治病根#14 告警进人眼）
import { client } from './index'

/** 立即巡检（手动触发一轮·同定时器）。 */
export const runInspect = () => client.post('runInspect')
/** 最新体检报告 + 未处理异常计数。 */
export const getInspectStatus = () => client.post('getInspectStatus')
/** 异常账本列表（可筛 resolved/kind·有界）。 */
export const listAnomalies = (opts: { resolved?: boolean; kind?: string; limit?: number } = {}) =>
  client.post('listAnomalies', opts)
/** 标记异常已处理。 */
export const resolveAnomaly = (id: string) => client.post('resolveAnomaly', { id })
/** 审计日志（批 B6·操作审计#4 读出口·cursor 分页·仅超管）：谁在何时做了什么操作。 */
export const listAudit = (
  opts: { cursor?: unknown; limit?: number; operator?: string; actionPrefix?: string; from?: number; to?: number } = {},
) => client.post('listAudit', opts)

// 客服组 api（薄封装）
// 回包类型取 @ldrw/shared 的后台契约
import type {
  AdminConversations,
  AdminConversationsReport,
  AdminCustomer360,
  AdminUser,
  AdminCustomerHits,
  AdminKb,
  AdminSavedCount,
  AdminCsatReport,
  AdminCsatEntries,
  AdminCheckpoints,
  AdminRev,
  AdminQcSampled,
  AdminQcList,
  AdminTrialRefreshGate,
  AdminTrialRefreshed,
} from '@ldrw/shared'
import { typedPost } from './index'

export const searchConversations = (filter: { openid?: string; externalUserId?: string; channel?: string; keyword?: string; cursor?: unknown; limit?: number }) =>
  typedPost<AdminConversations>('searchConversations', filter as Record<string, unknown>)
export const conversationsReport = (slaMs?: number) => typedPost<AdminConversationsReport>('conversationsReport', slaMs ? { slaMs } : {})
export const getCustomer360 = (openid: string) => typedPost<AdminCustomer360>('getCustomer360', { openid })
export const getUser = (openid: string) => typedPost<AdminUser>('getUser', { openid }) // 单人画像·身份头（Customer360 用）
export const searchCustomer = (q: string) => typedPost<AdminCustomerHits>('searchCustomer', { q })
export const listKb = () => typedPost<AdminKb>('listKb')
export const saveKb = (entries: unknown[]) => typedPost<AdminSavedCount>('saveKb', { entries })
export const getCsatReport = () => typedPost<AdminCsatReport>('getCsatReport')
export const listCsatEntries = (filter: { cursor?: unknown; limit?: number; from?: number; to?: number; maxScore?: number }) =>
  typedPost<AdminCsatEntries>('listCsatEntries', filter as Record<string, unknown>)
export const listCheckpoints = (courseId?: string) => typedPost<AdminCheckpoints>('listCheckpoints', courseId ? { courseId } : {})
// baseRev＝拉取时的版本号（乐观并发·课程级 CAS 元档）：不符后端回 DRAFT_CONFLICT 拒整课覆盖
// 失败包 rev：DRAFT_CONFLICT 带库里现有版本，GC_REMOVE_FAIL（新节点已存）带写后版本
export const saveCheckpoints = (courseId: string, nodes: unknown[], baseRev?: number) =>
  typedPost<AdminSavedCount & AdminRev, AdminRev>('saveCheckpoints', { courseId, nodes, baseRev })
// 质检抽检：sessionKey=csSession._id（非 externalUserId——listCsatEntries 明细行的客户标识字段叫 externalUserId）
export const sampleQc = (count = 10) => typedPost<AdminQcSampled>('sampleQc', { count })
export const saveQcMark = (sessionKey: string, score: number, note: string) => typedPost<object>('saveQcMark', { sessionKey, score, note })
export const listQcSampled = (filter: { cursor?: unknown; limit?: number; onlyPending?: boolean } = {}) =>
  typedPost<AdminQcList>('listQcSampled', filter as Record<string, unknown>)
export const getTrialRefreshGate = () => typedPost<AdminTrialRefreshGate>('getTrialRefreshGate')
export const refreshTrialSession = (data: {
  reason: string
  force?: boolean
  externalUserId?: string
  externalUserIds?: string[]
  sessionId?: string
  sessionIds?: string[]
  openid?: string
  openids?: string[]
}) => typedPost<AdminTrialRefreshed>('refreshTrialSession', data as Record<string, unknown>)

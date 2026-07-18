// 客服组 api（薄封装）
import { client } from './index'

export const searchConversations = (filter: { openid?: string; externalUserId?: string; channel?: string; keyword?: string; cursor?: unknown; limit?: number }) =>
  client.post('searchConversations', filter as Record<string, unknown>)
export const conversationsReport = (slaMs?: number) => client.post('conversationsReport', slaMs ? { slaMs } : {})
export const getCustomer360 = (openid: string) => client.post('getCustomer360', { openid })
export const getUser = (openid: string) => client.post('getUser', { openid }) // 单人画像·身份头（换皮没导出·坐席看不到姓名/手机）
export const searchCustomer = (q: string) => client.post('searchCustomer', { q })
export const listKb = () => client.post('listKb')
export const saveKb = (entries: unknown[]) => client.post('saveKb', { entries })
export const getCsatReport = () => client.post('getCsatReport')
export const listCsatEntries = (filter: { cursor?: unknown; limit?: number; from?: number; to?: number; maxScore?: number }) =>
  client.post('listCsatEntries', filter as Record<string, unknown>)
export const listCheckpoints = (courseId?: string) => client.post('listCheckpoints', courseId ? { courseId } : {})
// baseRev＝拉取时的版本号（乐观并发·批A 内容域并发安全·课程级 CAS 元档）：不符后端回 DRAFT_CONFLICT 拒整课覆盖
export const saveCheckpoints = (courseId: string, nodes: unknown[], baseRev?: number) => client.post('saveCheckpoints', { courseId, nodes, baseRev })
// 质检抽检（批 B7）：sessionKey=csSession._id（非 externalUserId——listCsatEntries 明细行已改名为 externalUserId，字段已分开不再撞名）
export const sampleQc = (count = 10) => client.post('sampleQc', { count })
export const saveQcMark = (sessionKey: string, score: number, note: string) => client.post('saveQcMark', { sessionKey, score, note })
export const listQcSampled = (filter: { cursor?: unknown; limit?: number; onlyPending?: boolean } = {}) =>
  client.post('listQcSampled', filter as Record<string, unknown>)

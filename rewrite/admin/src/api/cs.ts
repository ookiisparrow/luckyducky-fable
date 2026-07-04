// 客服组 api（薄封装）
import { client } from './index'

export const searchConversations = (filter: { openid?: string; externalUserId?: string; channel?: string; keyword?: string; cursor?: unknown; limit?: number }) =>
  client.post('searchConversations', filter as Record<string, unknown>)
export const conversationsReport = (slaMs?: number) => client.post('conversationsReport', slaMs ? { slaMs } : {})
export const getCustomer360 = (openid: string) => client.post('getCustomer360', { openid })
export const searchCustomer = (q: string) => client.post('searchCustomer', { q })
export const listKb = () => client.post('listKb')
export const saveKb = (entries: unknown[]) => client.post('saveKb', { entries })
export const getCsatReport = () => client.post('getCsatReport')
export const listCheckpoints = (courseId?: string) => client.post('listCheckpoints', courseId ? { courseId } : {})
export const saveCheckpoints = (courseId: string, nodes: unknown[]) => client.post('saveCheckpoints', { courseId, nodes })

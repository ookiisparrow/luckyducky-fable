// 系统组 + 钱组补齐 api（薄封装）
import { client } from './index'

export const listAgents = () => client.post('listAgents')
export const createAgent = (name: string, key: string, wecomUserId?: string) => client.post('createAgent', { name, key, wecomUserId })
export const disableAgent = (id: string, disabled: boolean) => client.post('disableAgent', { id, disabled })
export const setAgentWecomUserId = (id: string, wecomUserId: string) => client.post('setAgentWecomUserId', { id, wecomUserId })

export const listBatches = (courseId: string) => client.post('listBatches', { courseId })
export const createBatch = (courseId: string, count: number) => client.post('createBatch', { courseId, count })
export const listBatchCodes = (batchId: string) => client.post('listBatchCodes', { batchId })

export const getSettings = () => client.post('getSettings')
export const saveSettings = (patch: Record<string, unknown>) => client.post('saveSettings', patch)

// from/to='YYYY-MM-DD' 自定义对账区间（后端支持·不传=近 30 天默认窗·根因#7）
export const getReconciliation = (from?: string, to?: string) => client.post('getReconciliation', { from: from || undefined, to: to || undefined })
export const getBillMatch = (from?: string, to?: string) => client.post('getBillMatch', { from: from || undefined, to: to || undefined })
export const downloadBill = (date: string) => client.post('downloadBill', { date })

export const listInventory = () => client.post('listInventory')
export const saveStock = (productId: string, spec: string, stock: number | null, expectedUpdatedAt: number) =>
  client.post('saveStock', { productId, spec, stock, expectedUpdatedAt })

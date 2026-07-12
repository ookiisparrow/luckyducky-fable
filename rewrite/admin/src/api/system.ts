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

// 人工配置清单（批 B9→可填写升级）：散落配置一屏拼「配了没」（条数由后端 groups 动态计·不手抄）；带 fill 元数据的项可在本页直接填写保存
export const getConfigChecklist = () => client.post('getConfigChecklist')
export const saveSecureConfig = (docId: string, fields: Record<string, string>) => client.post('saveSecureConfig', { docId, fields })
export const savePayConfig = (patch: Record<string, string>) => client.post('savePayConfig', patch)

// from/to='YYYY-MM-DD' 自定义对账区间（后端支持·不传=近 30 天默认窗·根因#7）
export const getReconciliation = (from?: string, to?: string) => client.post('getReconciliation', { from: from || undefined, to: to || undefined })
export const getBillMatch = (from?: string, to?: string) => client.post('getBillMatch', { from: from || undefined, to: to || undefined })
export const downloadBill = (date: string) => client.post('downloadBill', { date })

export const listInventory = () => client.post('listInventory')
// threshold＝per-SKU 低库存阈值（后端 saveStock 早支持·换皮漏传·恒硬编码 10）；undefined=不改
export const saveStock = (productId: string, spec: string, stock: number | null, expectedUpdatedAt: number, threshold?: number) =>
  client.post('saveStock', { productId, spec, stock, expectedUpdatedAt, threshold })

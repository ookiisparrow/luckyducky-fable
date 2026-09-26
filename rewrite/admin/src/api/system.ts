// 系统组 + 钱组补齐 api（薄封装）
// 回包类型取 @ldrw/shared 的后台契约
import type {
  AdminAgents,
  AdminAgentCreated,
  AdminAgentDisabled,
  AdminAgentWecomBound,
  AdminBatches,
  AdminBatchCreated,
  AdminBatchCodes,
  AdminSettings,
  AdminConfigChecklist,
  AdminReconciliation,
  AdminBillMatch,
  AdminBillDownloaded,
  AdminInventory,
} from '@ldrw/shared'
import { typedPost } from './index'

export const listAgents = () => typedPost<AdminAgents>('listAgents')
export const createAgent = (name: string, key: string, wecomUserId?: string) => typedPost<AdminAgentCreated>('createAgent', { name, key, wecomUserId })
export const disableAgent = (id: string, disabled: boolean) => typedPost<AdminAgentDisabled>('disableAgent', { id, disabled })
export const setAgentWecomUserId = (id: string, wecomUserId: string) => typedPost<AdminAgentWecomBound>('setAgentWecomUserId', { id, wecomUserId })

export const listBatches = (courseId: string) => typedPost<AdminBatches>('listBatches', { courseId })
export const createBatch = (courseId: string, count: number) => typedPost<AdminBatchCreated>('createBatch', { courseId, count })
export const listBatchCodes = (batchId: string, page?: { cursor?: unknown; limit?: number }) =>
  typedPost<AdminBatchCodes>('listBatchCodes', { batchId, ...page })

export const getSettings = () => typedPost<AdminSettings>('getSettings')
export const saveSettings = (patch: Record<string, unknown>) => typedPost<object>('saveSettings', patch)

// 人工配置清单：散落配置一屏拼「配了没」（条数由后端 groups 动态计·不手抄）；带 fill 元数据的项可在本页直接填写保存
export const getConfigChecklist = () => typedPost<AdminConfigChecklist>('getConfigChecklist')
export const saveSecureConfig = (docId: string, fields: Record<string, string>) => typedPost<object>('saveSecureConfig', { docId, fields })
export const savePayConfig = (patch: Record<string, string>) => typedPost<object>('savePayConfig', patch)

// from/to='YYYY-MM-DD' 自定义对账区间（后端支持·不传=近 30 天默认窗·根因#7）
export const getReconciliation = (from?: string, to?: string) => typedPost<AdminReconciliation>('getReconciliation', { from: from || undefined, to: to || undefined })
export const getBillMatch = (from?: string, to?: string) => typedPost<AdminBillMatch>('getBillMatch', { from: from || undefined, to: to || undefined })
export const downloadBill = (date: string) => typedPost<AdminBillDownloaded>('downloadBill', { date })

export const listInventory = () => typedPost<AdminInventory>('listInventory')
// threshold＝per-SKU 低库存阈值（后端 saveStock 支持）；undefined=不改
export const saveStock = (productId: string, spec: string, stock: number | null, expectedUpdatedAt: number, threshold?: number) =>
  typedPost<object>('saveStock', { productId, spec, stock, expectedUpdatedAt, threshold })

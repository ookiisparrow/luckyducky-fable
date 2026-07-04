// 进销存 api（薄封装）
import { client } from './index'

export const listMaterials = () => client.post('listMaterials')
export const saveMaterial = (m: Record<string, unknown>) => client.post('saveMaterial', m)
export const listSuppliers = () => client.post('listSuppliers')
export const saveSupplier = (s: Record<string, unknown>) => client.post('saveSupplier', s)
export const adjustStock = (materialId: string, delta: number, reason: string) =>
  client.post('adjustStock', { materialId, delta, reason, adjustId: 'adm-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) })
export const listLedger = (materialId?: string) => client.post('listLedger', materialId ? { materialId } : {})

export const listPurchases = (status?: string) => client.post('listPurchases', status ? { status } : {})
export const savePurchase = (supplierId: string, lines: unknown[], purchaseId?: string) => client.post('savePurchase', { supplierId, lines, purchaseId })
export const markOrdered = (purchaseId: string) => client.post('markOrdered', { purchaseId })
export const receivePurchase = (purchaseId: string) => client.post('receivePurchase', { purchaseId })
export const cancelPurchase = (purchaseId: string) => client.post('cancelPurchase', { purchaseId })

export const listOutworks = (status?: string) => client.post('listOutworks', status ? { status } : {})
export const saveOutwork = (workerId: string, pieceRateFen: number, issueLines: unknown[], outworkId?: string) =>
  client.post('saveOutwork', { workerId, pieceRateFen, issueLines, outworkId })
export const issueOutwork = (outworkId: string) => client.post('issueOutwork', { outworkId })
export const receiveOutwork = (outworkId: string, receiveLines: unknown[]) => client.post('receiveOutwork', { outworkId, receiveLines })
export const settleOutwork = (outworkId: string) => client.post('settleOutwork', { outworkId })
export const cancelOutwork = (outworkId: string) => client.post('cancelOutwork', { outworkId })

export const getBomSetup = () => client.post('getBomSetup')
export const saveBomTemplate = (template: Record<string, unknown>) => client.post('saveBomTemplate', { template })
export const saveBomProfile = (profile: Record<string, unknown>) => client.post('saveBomProfile', { profile })
export const previewAssembly = (productId: string, sets: number) => client.post('previewAssembly', { productId, sets })
export const runAssembly = (productId: string, spec: string, sets: number) =>
  client.post('runAssembly', { productId, spec, sets, assemblyId: 'asm-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) })
export const listAssemblies = () => client.post('listAssemblies')

export const getRestockPlan = (targets: Array<{ productId: string; sets: number }>) => client.post('getRestockPlan', { targets })
export const getFgSummary = () => client.post('getFgSummary')

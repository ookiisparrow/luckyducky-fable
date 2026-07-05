// 进销存 api（薄封装）
import { client } from './index'

export const listMaterials = () => client.post('listMaterials')
export const saveMaterial = (m: Record<string, unknown>) => client.post('saveMaterial', m)
export const listSuppliers = () => client.post('listSuppliers')
export const saveSupplier = (s: Record<string, unknown>) => client.post('saveSupplier', s)
// adjustId 由页面按调整意图持有传入（生成一次·重试复用·成功才换新）——同 runAssembly B1 幂等契约。
// 换皮在此内联现造新 id（Date.now+random）→ 重试/双击每次不同幂等键，绕过后端 docId 幂等闸→库存被调两次（根因#4）。
export const adjustStock = (materialId: string, delta: number, reason: string, adjustId: string) =>
  client.post('adjustStock', { materialId, delta, reason, adjustId })
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
// B1 修：assemblyId 由页面持有传入（每次组装意图生成一次·重试复用·成功才换新）——后端 _id=assemblyId
// 确定性 claim 幂等；换皮在此内联现生成新 id，重试/双击送不同 id 绕过幂等闸→双扣料双入库。
export const runAssembly = (productId: string, spec: string, sets: number, assemblyId: string) =>
  client.post('runAssembly', { productId, spec, sets, assemblyId })
export const listAssemblies = () => client.post('listAssemblies')

export const getRestockPlan = (targets: Array<{ productId: string; sets: number }>) => client.post('getRestockPlan', { targets })
export const getFgSummary = () => client.post('getFgSummary')

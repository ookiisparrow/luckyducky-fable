// 进销存 api（薄封装）
// 回包类型取 @ldrw/shared 的后台契约
import type {
  AdminMaterials,
  AdminDocPage,
  AdminMaterialSaved,
  AdminSupplierSaved,
  AdminStockApplied,
  AdminPurchaseSaved,
  AdminMoved,
  AdminPurchaseReceived,
  AdminOutworkSaved,
  AdminOutworkReceived,
  AdminBomSetup,
  AdminBomProfileSaved,
  AdminAssemblyPreview,
  AdminAssembled,
  AdminRestockPlan,
  AdminFgSummary,
  AdminScmOverview,
} from '@ldrw/shared'
import { typedPost } from './index'

// 根因#7：以下列表口子带可选 {cursor,limit} 透传（同 Conversations.vue/Orders.vue 翻页模式）；
// 不传即首页默认。picker 消费点（各页选厂家/织女下拉等无参调 listSuppliers 处）不用传。
type Page = { cursor?: unknown; limit?: number }

export const listMaterials = () => typedPost<AdminMaterials>('listMaterials')
export const saveMaterial = (m: Record<string, unknown>) => typedPost<AdminMaterialSaved>('saveMaterial', m)
export const listSuppliers = (page?: Page) => typedPost<AdminDocPage>('listSuppliers', page || {})
export const saveSupplier = (s: Record<string, unknown>) => typedPost<AdminSupplierSaved>('saveSupplier', s)
// adjustId 由页面按调整意图持有传入（生成一次·重试复用·成功才换新）——同 runAssembly 幂等契约。
// 若在此内联现造新 id（Date.now+random）→ 重试/双击每次不同幂等键，绕过后端 docId 幂等闸→库存被调两次（根因#1）。
export const adjustStock = (materialId: string, delta: number, reason: string, adjustId: string) =>
  typedPost<AdminStockApplied>('adjustStock', { materialId, delta, reason, adjustId })
export const listLedger = (materialId?: string, page?: Page) =>
  typedPost<AdminDocPage>('listLedger', { ...(materialId ? { materialId } : {}), ...(page || {}) })

export const listPurchases = (status?: string, page?: Page) =>
  typedPost<AdminDocPage>('listPurchases', { ...(status ? { status } : {}), ...(page || {}) })
export const savePurchase = (supplierId: string, lines: unknown[], purchaseId?: string) =>
  typedPost<AdminPurchaseSaved>('savePurchase', { supplierId, lines, purchaseId })
export const markOrdered = (purchaseId: string) => typedPost<AdminMoved>('markOrdered', { purchaseId })
export const receivePurchase = (purchaseId: string) => typedPost<AdminPurchaseReceived>('receivePurchase', { purchaseId })
export const cancelPurchase = (purchaseId: string) => typedPost<AdminMoved>('cancelPurchase', { purchaseId })

export const listOutworks = (status?: string, page?: Page) =>
  typedPost<AdminDocPage>('listOutworks', { ...(status ? { status } : {}), ...(page || {}) })
export const saveOutwork = (workerId: string, pieceRateFen: number, issueLines: unknown[], outworkId?: string) =>
  typedPost<AdminOutworkSaved>('saveOutwork', { workerId, pieceRateFen, issueLines, outworkId })
export const issueOutwork = (outworkId: string) => typedPost<AdminStockApplied>('issueOutwork', { outworkId })
export const receiveOutwork = (outworkId: string, receiveLines: unknown[]) =>
  typedPost<AdminOutworkReceived>('receiveOutwork', { outworkId, receiveLines })
export const settleOutwork = (outworkId: string) => typedPost<AdminMoved>('settleOutwork', { outworkId })
export const cancelOutwork = (outworkId: string) => typedPost<AdminMoved>('cancelOutwork', { outworkId })

export const getBomSetup = () => typedPost<AdminBomSetup>('getBomSetup')
export const saveBomTemplate = (template: Record<string, unknown>) => typedPost<object>('saveBomTemplate', { template })
export const saveBomProfile = (profile: Record<string, unknown>) => typedPost<AdminBomProfileSaved>('saveBomProfile', { profile })
export const previewAssembly = (productId: string, sets: number) => typedPost<AdminAssemblyPreview>('previewAssembly', { productId, sets })
// assemblyId 由页面持有传入（每次组装意图生成一次·重试复用·成功才换新）——后端 _id=assemblyId
// 确定性 claim 幂等；若在此内联现生成新 id，重试/双击送不同 id 绕过幂等闸→双扣料双入库。
export const runAssembly = (productId: string, spec: string, sets: number, assemblyId: string) =>
  typedPost<AdminAssembled>('runAssembly', { productId, spec, sets, assemblyId })
export const listAssemblies = (page?: Page) => typedPost<AdminDocPage>('listAssemblies', page || {})

export const getRestockPlan = (targets: Array<{ productId: string; sets: number }>) =>
  typedPost<AdminRestockPlan>('getRestockPlan', { targets })
export const getFgSummary = () => typedPost<AdminFgSummary>('getFgSummary')

// 总览：低库存预警 + 应付未结按织女分组 + 在途采购/外协计数 + 最近流水，只读聚合着陆页
export const getScmOverview = () => typedPost<AdminScmOverview>('getScmOverview')

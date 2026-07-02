import { reply, str, type Ctx } from '../lib'
import { COLLECTIONS, applyStockMoves, listStockLedger, saveMaterialDoc, listMaterialDocs } from '../../../../kit'
import { yarnMaterialId } from '@luckyducky/shared'

// 进销存 SCM-0 地基·物料/供应商主档 + 期初盘点/调整（蓝图 docs/进销存ERP/·门5 文件级隔离：本文件=SCM-0 车道）。
// 库存/主档持久化收口 kit/scmStock（门1·守卫 material-stock-single-seam）；本文件只做入参校验 + 料号推导 + 转调。
// RBAC：不登记 ACTION_CAPS → 默认拒 admin:write＝仅超管（外包坐席天然无权·蓝图门5）；写类 action 自动审计（shouldAudit）。

const SLUG = /^[a-z][a-z0-9-]*$/ // 料号成分（颜色/辅料名）：小写字母开头的 slug，保 _id 干净可读

// ── 物料主档 ──

export async function listMaterials({ data }: Ctx) {
  const limit = data && Number.isInteger(data.limit) ? data.limit : 500
  return reply(200, { ok: true, list: await listMaterialDocs(limit) })
}

export async function saveMaterial({ data }: Ctx) {
  const name = str(data.name, 60)
  const category = String(data.category || '')
  const uom = String(data.uom || '')
  if (!name) return reply(400, { ok: false, error: 'NO_NAME' })
  if (uom !== 'count' && uom !== 'gram') return reply(400, { ok: false, error: 'BAD_UOM' }) // 计量二选一（守卫 scm-uom-integer）
  const threshold = data.threshold != null ? parseInt(data.threshold, 10) : 0
  if (!Number.isInteger(threshold) || threshold < 0) return reply(400, { ok: false, error: 'BAD_THRESHOLD' })

  // 确定性料号推导（命名契约·与 shared/scmBom yarnMaterialId 同源）
  let _id = ''
  let spec: Record<string, string> | undefined
  if (category === 'yarn') {
    const color = String(data.color || '')
    const tier = String(data.tier || '')
    const form = String(data.form || '')
    if (!SLUG.test(color)) return reply(400, { ok: false, error: 'BAD_COLOR' })
    if (tier !== 'L' && tier !== 'M' && tier !== 'S') return reply(400, { ok: false, error: 'BAD_TIER' })
    if (form !== 'raw' && form !== 'knotted') return reply(400, { ok: false, error: 'BAD_FORM' })
    if (form === 'knotted' && tier !== 'L') return reply(400, { ok: false, error: 'KNOT_ONLY_L' }) // 带结仅最大团（用户拍板）
    _id = yarnMaterialId(color, tier, form)
    spec = { color, tier, form }
  } else if (category === 'packaging' || category === 'card') {
    const productId = String(data.productId || '')
    if (!productId) return reply(400, { ok: false, error: 'NO_PRODUCT' })
    _id = (category === 'packaging' ? 'pkg:' : 'card:') + productId
  } else if (category === 'accessory') {
    const slug = String(data.slug || '')
    if (!SLUG.test(slug)) return reply(400, { ok: false, error: 'BAD_SLUG' })
    _id = slug
  } else {
    return reply(400, { ok: false, error: 'BAD_CATEGORY' })
  }

  const r = await saveMaterialDoc({
    _id,
    name,
    category,
    uom,
    supplierId: String(data.supplierId || ''),
    threshold,
    active: data.active !== false,
    spec,
  })
  if (r === 'UOM_LOCKED') return reply(400, { ok: false, error: 'UOM_LOCKED' }) // 建档后不可改计量（混账）
  return reply(200, { ok: true, materialId: _id })
}

// ── 供应商/织女主档 ──

export async function listSuppliers({ db }: Ctx) {
  const r = await db.collection(COLLECTIONS.suppliers).limit(200).get().catch(() => ({ data: [] }))
  return reply(200, { ok: true, list: r.data || [] })
}

export async function saveSupplier({ db, data }: Ctx) {
  const name = str(data.name, 60)
  const type = String(data.type || '')
  if (!name) return reply(400, { ok: false, error: 'NO_NAME' })
  if (type !== 'factory' && type !== 'outworker') return reply(400, { ok: false, error: 'BAD_TYPE' }) // 厂家 | 织女
  const fields = {
    name,
    type,
    contact: str(data.contact, 120),
    note: str(data.note, 200),
    active: data.active !== false,
    updatedAt: Date.now(),
  }
  const supplierId = String(data.supplierId || '')
  const coll = db.collection(COLLECTIONS.suppliers)
  if (supplierId) {
    const r = await coll.doc(supplierId).update({ data: fields }).catch(() => ({ stats: { updated: 0 } }))
    if (!r.stats || r.stats.updated !== 1) return reply(404, { ok: false, error: 'NO_SUPPLIER' })
    return reply(200, { ok: true, supplierId })
  }
  const added = await coll.add({ data: fields })
  return reply(200, { ok: true, supplierId: added.id || added._id || '' })
}

// ── 期初盘点 / 人工调整（经门1·docType adjust·流水留痕）──

export async function adjustStock({ data, agentId }: Ctx) {
  const materialId = String(data.materialId || '')
  const adjustId = String(data.adjustId || '') // 前端每次提交生成一次·重试复用＝幂等键成分
  const reason = str(data.reason, 200)
  if (!materialId || !adjustId) return reply(400, { ok: false, error: 'BAD_ADJUST' })
  if (!reason) return reply(400, { ok: false, error: 'NO_REASON' }) // 调整必留因（审计可读）
  const delta = data.delta
  if (!Number.isInteger(delta) || delta === 0) return reply(400, { ok: false, error: 'BAD_DELTA' }) // 克/件整数（守卫 scm-uom-integer）
  const r = await applyStockMoves([{ materialId, delta }], { docType: 'adjust', docId: adjustId, operator: agentId || 'admin', reason })
  if (!r.ok) return reply(r.error === 'INSUFFICIENT' ? 409 : 400, { ok: false, error: r.error, materialId: r.materialId })
  return reply(200, { ok: true, applied: r.applied })
}

// ── 流水查账（只读·bounded）──

export async function listLedger({ data }: Ctx) {
  const materialId = data.materialId ? String(data.materialId) : undefined
  const limit = data && Number.isInteger(data.limit) ? data.limit : 50
  return reply(200, { ok: true, list: await listStockLedger(materialId, limit) })
}

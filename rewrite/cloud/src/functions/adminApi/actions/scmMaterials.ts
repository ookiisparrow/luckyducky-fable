import { reply, str, type Ctx } from '../lib'
import { applyStockMoves, listStockLedger, saveMaterialDoc, listMaterialDocs, pageQuery } from '../../../kit'
import { COLLECTIONS } from '@ldrw/shared'
import { yarnMaterialId } from '@ldrw/shared'

// 进销存 SCM-0 地基·物料/供应商主档 + 期初盘点/调整（见 docs/业务逻辑架构.md 链 12·门5 文件级隔离：本文件=SCM-0 车道）。
// 库存/主档持久化收口 kit/scmStock（门1·守卫 rw-material-stock-single-seam）；本文件只做入参校验 + 料号推导 + 转调。
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
  if (r === 'DUPLICATE') return reply(409, { ok: false, error: 'DUPLICATE' }) // 并发首建同一物料（同 runAssembly 409 口径）
  return reply(200, { ok: true, materialId: _id })
}

// ── 供应商/织女主档 ──

// 供应商没有自然排序字段，按 _id 游标翻页；无参首页仍默认 200，游标原样交给 pageQuery。
const SUPPLIER_LIST_LIMIT = 200

export async function listSuppliers({ db, data }: Ctx) {
  const paged = await pageQuery(db, COLLECTIONS.suppliers, {}, '_id', data, SUPPLIER_LIST_LIMIT)
  return reply(200, { ok: true, list: paged.list, nextCursor: paged.nextCursor, hasMore: paged.hasMore })
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
  // trim 后判空（D2·同 scmBom saveBomProfile productId trim 判例）：不 trim 会放行纯空格 reason，
  // 落库看似「有原因」实则不可读，审计追责时形同白填。
  const reason = str(data.reason, 200).trim()
  if (!materialId || !adjustId) return reply(400, { ok: false, error: 'BAD_ADJUST' })
  // 拒成品 fg: 调整（深审 P2·假成功账实分叉）：applyStockMoves 对 fg: 行跳过 casChange（成品账在 kit/inventory·
  // 流水行只留痕），adjust 走这里会收 ok:true/applied:1 但 materials/inventory 纹丝不动＝假成功、留一条 stray fg
  // adjust 流水破坏对账公式。成品期初/人工调整须走 inventory.saveStock，不走原料调整口。
  if (materialId.startsWith('fg:')) return reply(400, { ok: false, error: 'FG_NOT_ADJUSTABLE' })
  if (!reason) return reply(400, { ok: false, error: 'NO_REASON' }) // 调整必留因（审计可读）
  const delta = data.delta
  if (!Number.isInteger(delta) || delta === 0) return reply(400, { ok: false, error: 'BAD_DELTA' }) // 克/件整数（守卫 scm-uom-integer）
  const r = await applyStockMoves([{ materialId, delta }], { docType: 'adjust', docId: adjustId, operator: agentId || 'admin', reason })
  if (!r.ok) return reply(r.error === 'INSUFFICIENT' ? 409 : 400, { ok: false, error: r.error, materialId: r.materialId })
  return reply(200, { ok: true, applied: r.applied })
}

// ── 流水查账（只读·cursor 分页）──
// B1（根因#7）：真实现改在 kit/scmStock.ts listStockLedger（走 pageQuery），本 action 只透传 {cursor,limit}。

export async function listLedger({ data }: Ctx) {
  const materialId = data.materialId ? String(data.materialId) : undefined
  const paged = await listStockLedger(materialId, data)
  return reply(200, { ok: true, list: paged.list, nextCursor: paged.nextCursor, hasMore: paged.hasMore })
}

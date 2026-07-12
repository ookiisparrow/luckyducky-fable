import { reply, str, type Ctx } from '../lib'
import { applyStockMoves, listStockLedger, saveMaterialDoc, listMaterialDocs, pageQuery } from '../../../kit'
import { COLLECTIONS } from '@ldrw/shared'
import { yarnMaterialId } from '@ldrw/shared'

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

// B1（根因#7）：改走 kit pageQuery——旧 .limit(200) 裸封顶超上限旧档永久不可查；defaultLimit=200
// 沿用旧上限，无参调用（多处 picker 下拉全量消费点）行为零变化。
//
// cursorField 用 `_id`（供应商表无自然排序字段·蓝图 B1 主脑裁决）：kit pageQuery 复合游标的 tie/span
// 双分支设计假定 cursorField≠_id（tie 分支靠「同 cursorField 值·不同 _id」区分同值记录打破平局）；当
// cursorField===_id 时 v===id 恒成立，`{ [cursorField]: cursor.v, _id: beyond(cursor.id) }` 这一对象
// 字面量里两个键都叫 `_id`、后者覆盖前者，tie 分支的查询条件坍缩成与 span 分支完全相同的条件——两个
// 分支各自把剩余行整批取回、拼接后不去重直接 slice。剩余行数 R 较小时（R ≤ limit/2）只产生页内重复、
// 靠去重能清干净；但 R 较大时（limit/2 < R ≤ limit，即将进入尾页前一页）拼接体在 slice(limit+1) 处被
// 截断在「原序列中段」而非真正尾部，页内去重清得干净，但 pageQuery 内部据此算出的 hasMore/nextCursor
// 本身就是错的（hasMore 误报 true、nextCursor 指向一条已经交付过的记录）——只做页内去重堵不住这层，
// 会造成跨页重复交付（P1 复核实测：350 条供应商、limit 200 时命中）。kit/paging.ts 判定本批不许改
// （铁律），故不去修 pageQuery 内部，而是从根上避开这条坏分支：cursorField===_id 时 v===id 恒成立，
// 在调用前把客户端回传的复合游标 {v,id} 拆成纯值 id 再传给 pageQuery——pageQuery 收到非 {v,id} 形状
// 的游标会落进「向后兼容纯值游标」分支（单一查询，无 tie/span 拼接），该分支的 hasMore/nextCursor 本
// 身即正确，无需再在此兜底去重。首页（无 cursor）不受影响，「无参调用行为零变化」契约不受影响。
const SUPPLIER_LIST_LIMIT = 200

export async function listSuppliers({ db, data }: Ctx) {
  const rawCursor = data && (data as any).cursor
  const cursor = rawCursor && typeof rawCursor === 'object' && 'id' in rawCursor ? (rawCursor as any).id : rawCursor
  const paged = await pageQuery(db, COLLECTIONS.suppliers, {}, '_id', { ...data, cursor }, SUPPLIER_LIST_LIMIT)
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
  const reason = str(data.reason, 200)
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

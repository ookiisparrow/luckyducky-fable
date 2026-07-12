import { reply, type Ctx } from '../lib'
import { transition, applyStockMoves, listMaterialDocs, pageQuery } from '../../../kit'
import { COLLECTIONS } from '@ldrw/shared'
import { asFen, PURCHASE_ORDER_TRANSITIONS } from '@ldrw/shared'

// 进销存车道 A·采购线（蓝图 docs/进销存ERP/ §4·门5 文件级隔离：本文件=车道 A）。
// 状态机 draft→ordered→received（+draft/ordered→cancelled·声明表 shared/scm.spec.ts·门2 transition 收口·
// 守卫 order-transitions-declared 按 scm* 前缀自动纳管本文件）；received 首次流转绑入库副作用（门1
// applyStockMoves·docType purchase_in·确定性流水幂等——重放 moved=false 直接返回已入库、不双记账）。
// 金额全链整数分（unitPriceFen/totalFen·totalFen 服务端算不信前端·根因#4）；数量正整数（守卫 scm-uom-integer 纪律）。
// RBAC：不登记 ACTION_CAPS → 默认拒 admin:write＝仅超管（外包坐席天然无权·蓝图门5）；写类 action 自动审计（shouldAudit）。
// 集合名用字面量 'purchaseOrders'（known-collections-only 在册）——order-transitions-declared 靠字面量归属 status 写入点。

const MAX_LINES = 50 // 单据行数上限（bounded·一张采购单不至于超·防垃圾大单）

/** 从声明流转表（scm.spec.ts→scm.ts 生成物）按目标态取合法 from 集合——该表内每个 to 只出现一次
 *  （见 shared/scm.spec.ts 头注），故按 to 反查唯一。改流转边只改 scm.spec.ts 再跑生成器，
 *  本函数自动跟着变——不再像此前那样在各 transition() 调用点手写字面量、与生成物各背各的。 */
function fromFor(to: string): string[] {
  const t = PURCHASE_ORDER_TRANSITIONS.find((x) => x.to === to)
  if (!t) throw new Error(`PURCHASE_ORDER_TRANSITIONS 未声明 to='${to}'（scm.spec.ts 与 scmPurchase.ts 不同步）`)
  return [...t.from]
}

interface PurchaseLine {
  materialId: string
  qty: number
  unitPriceFen: number
}

/** 行校验 fail-closed（根因#8 假数据不入账）：qty 正整数、unitPriceFen 非负整数分、料号在主档、无重复行。
 *  重复料号必拒——received 入库流水 _id=`purchase_in:<docId>:<materialId>`，同料两行会撞幂等键漏记后行。 */
async function validateLines(raw: any): Promise<{ ok: true; lines: PurchaseLine[]; totalFen: number } | { ok: false; error: string; materialId?: string }> {
  if (!Array.isArray(raw) || !raw.length) return { ok: false, error: 'BAD_LINES' }
  if (raw.length > MAX_LINES) return { ok: false, error: 'BAD_LINES' }
  const known = new Set((await listMaterialDocs()).map((m: any) => m._id)) // 主档只读校验（不写 materials·门1 之外无写）
  const seen = new Set<string>()
  const lines: PurchaseLine[] = []
  let totalFen = 0
  for (const l of raw) {
    const materialId = l && typeof l.materialId === 'string' ? l.materialId : ''
    if (!materialId) return { ok: false, error: 'BAD_LINES' }
    if (!known.has(materialId)) return { ok: false, error: 'NO_MATERIAL', materialId }
    if (seen.has(materialId)) return { ok: false, error: 'DUP_LINE', materialId }
    seen.add(materialId)
    const qty = l.qty
    if (!Number.isInteger(qty) || qty <= 0) return { ok: false, error: 'BAD_QTY', materialId }
    const unitPriceFen = l.unitPriceFen
    if (!Number.isInteger(unitPriceFen) || unitPriceFen < 0) return { ok: false, error: 'BAD_PRICE', materialId }
    lines.push({ materialId, qty, unitPriceFen: asFen(unitPriceFen) })
    totalFen += qty * unitPriceFen
  }
  return { ok: true, lines, totalFen: asFen(totalFen) }
}

// ── 列表（只读·cursor 分页·可按 status 过滤·createdAt 倒序）──
// B1（根因#7）：改走 kit pageQuery——旧 limit 直取封顶 200 会让超上限旧单永久不可查；defaultLimit
// 沿用旧默认值 100，无参调用首页条数零变化，翻页可续查历史全量。

const LIST_LIMIT = 100

export async function listPurchases({ db, data }: Ctx) {
  const filter: Record<string, unknown> = {}
  if (data && data.status) filter.status = String(data.status)
  const paged = await pageQuery(db, 'purchaseOrders', filter, 'createdAt', data, LIST_LIMIT)
  return reply(200, { ok: true, list: paged.list, nextCursor: paged.nextCursor, hasMore: paged.hasMore })
}

// ── 建/改草稿（仅 status=draft 可改·totalFen 服务端算·不信前端）──

export async function savePurchase({ db, data, agentId }: Ctx) {
  // 供应商须存在且是厂家（织女走车道 B 外协单·不混）
  const supplierId = String(data.supplierId || '')
  if (!supplierId) return reply(400, { ok: false, error: 'BAD_SUPPLIER' })
  const sup = await db.collection(COLLECTIONS.suppliers).doc(supplierId).get().catch(() => null)
  if (!sup || !sup.data || sup.data.type !== 'factory') return reply(400, { ok: false, error: 'BAD_SUPPLIER' })

  const v = await validateLines(data.lines)
  if (!v.ok) return reply(400, { ok: false, error: v.error, materialId: v.materialId })

  const now = Date.now()
  const fields = { supplierId, lines: v.lines, totalFen: v.totalFen, updatedAt: now } // 白名单字段·防杂字段入库
  const purchaseId = String(data.purchaseId || '')
  const coll = db.collection('purchaseOrders')
  if (purchaseId) {
    // 条件更新原子锁草稿态（where 含 status——ordered/received/cancelled 单据不可改·防改已入库单账目漂移）
    const r = await coll.where({ _id: purchaseId, status: 'draft' }).update({ data: fields }).catch(() => ({ stats: { updated: 0 } }))
    if (!r.stats || r.stats.updated !== 1) {
      const got = await coll.doc(purchaseId).get().catch(() => null)
      if (!got || !got.data) return reply(404, { ok: false, error: 'NO_PURCHASE' })
      return reply(409, { ok: false, error: 'NOT_DRAFT' })
    }
    return reply(200, { ok: true, purchaseId, totalFen: v.totalFen })
  }
  const added = await coll.add({ data: { ...fields, status: 'draft', createdAt: now, createdBy: agentId || 'admin' } })
  return reply(200, { ok: true, purchaseId: added.id || added._id || '', totalFen: v.totalFen })
}

// ── 状态流转（门2·声明边见 scm.spec.ts·重放幂等：目标态重放返 200 moved:false、其余 409）──

export async function markOrdered({ data }: Ctx) {
  const id = String(data.purchaseId || '')
  if (!id) return reply(400, { ok: false, error: 'BAD_ID' })
  const r = await transition('purchaseOrders', id, fromFor('ordered'), 'ordered', { orderedAt: Date.now(), updatedAt: Date.now() })
  if (!r.doc) return reply(404, { ok: false, error: 'NO_PURCHASE' })
  if (!r.moved && r.doc.status !== 'ordered') return reply(409, { ok: false, error: 'BAD_STATUS', current: r.doc.status })
  return reply(200, { ok: true, moved: r.moved })
}

export async function receivePurchase({ data, agentId }: Ctx) {
  const id = String(data.purchaseId || '')
  if (!id) return reply(400, { ok: false, error: 'BAD_ID' })
  const r = await transition('purchaseOrders', id, fromFor('received'), 'received', { receivedAt: Date.now(), updatedAt: Date.now() })
  if (!r.doc) return reply(404, { ok: false, error: 'NO_PURCHASE' })
  if (!r.moved) {
    // 重放天然幂等：已 received 直接返回（入库副作用绑首次流转·不双入库）；draft 直收/已取消＝非法流转拒
    if (r.doc.status === 'received') return reply(200, { ok: true, moved: false })
    return reply(409, { ok: false, error: 'BAD_STATUS', current: r.doc.status })
  }
  // 首次流转 → 门1 入库（各行 qty 正数·确定性流水 purchase_in:<单据id>:<料号>·并发重放撞幂等键跳过）
  const lines: PurchaseLine[] = Array.isArray(r.doc.lines) ? r.doc.lines : []
  const applied = await applyStockMoves(
    lines.map((l) => ({ materialId: l.materialId, delta: l.qty })),
    { docType: 'purchase_in', docId: id, operator: agentId || 'admin' }
  )
  if (!applied.ok) {
    // 几乎不可达（正数入库无 INSUFFICIENT·主档无删除路径无 NO_MATERIAL·CAS 重试 5 次）——万一到此：
    // 状态已 received 而账未动，诚实报错留审计（shouldAudit 记 ok:false），人工经 adjustStock 补账（流水可查）
    return reply(500, { ok: false, error: 'STOCK_APPLY_FAIL', detail: applied.error, materialId: applied.materialId })
  }
  return reply(200, { ok: true, moved: true, applied: applied.applied })
}

export async function cancelPurchase({ data }: Ctx) {
  const id = String(data.purchaseId || '')
  if (!id) return reply(400, { ok: false, error: 'BAD_ID' })
  const r = await transition('purchaseOrders', id, fromFor('cancelled'), 'cancelled', { cancelledAt: Date.now(), updatedAt: Date.now() })
  if (!r.doc) return reply(404, { ok: false, error: 'NO_PURCHASE' })
  // received 后不可取消（状态机声明表无 received→cancelled 边·天然拒）——入库后的账走调整单
  if (!r.moved && r.doc.status !== 'cancelled') return reply(409, { ok: false, error: 'BAD_STATUS', current: r.doc.status })
  return reply(200, { ok: true, moved: r.moved })
}

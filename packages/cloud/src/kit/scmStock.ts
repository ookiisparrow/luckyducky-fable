import { getDb } from './db'
import { COLLECTIONS } from './collections'

// 原料账原子原语（进销存 SCM-0 门1·根因#1/#2·镜像 kit/inventory.ts 范式）。
// **全库唯一** materials.stock / stockLedger 读写处（守卫 material-stock-single-seam）——任何单据出入库
// （采购入库/外协发收/组装扣料/调整/期初/发货核销）都经 applyStockMoves，换存储/加损耗逻辑只改这点。
//
// 幂等（守卫 scm-ledger-idempotent）：每笔流水确定性 _id=`<docType>:<docId>:<itemKey>`——同一单据对同一
// 物料重放时 add 撞 DUPLICATE_ID＝并发方/上次已写，跳过不双记账（同 deterministic-id 范式）。
// 并发：库存变更走乐观 CAS（读 stock → where({_id, stock:读值}).update 绝对值·updated===1 才算改到），
// 与 kit/inventory 同款；不足/争用耗尽即失败并**回滚本次已应用行**（宁不动账勿错账）。
// 计量：delta 一律非零整数（克或件·单位随主档 uom·validate fail-closed）；余额不允许为负。

export type MoveDocType =
  | 'purchase_in' // 采购到货入库（车道 A）
  | 'outwork_issue' // 外协发料出库（车道 B）
  | 'outwork_receive' // 外协交付入库（车道 B）
  | 'assembly_out' // 组装扣原料（车道 C）
  | 'assembly_in' // 组装入成品（车道 C·itemKey=fg:<productId>__<spec>）
  | 'adjust' // 期初盘点/人工调整（SCM-0·须 reason）
  | 'ship' // 发货核销留痕（车道 D·itemKey=fg:…）

export interface StockMove {
  materialId: string // 料号（materials._id）；成品行用 fg: 前缀 itemKey、不动 materials
  delta: number // ± 非零整数（克或件·按主档 uom）
}

export interface MoveDoc {
  docType: MoveDocType
  docId: string // 来源单据 id（幂等键成分）
  operator?: string
  reason?: string // adjust 必填（审计可读）
}

const CAS_RETRY = 5
const ledgerIdOf = (docType: string, docId: string, itemKey: string) => `${docType}:${docId}:${itemKey}`

export type ApplyResult =
  | { ok: true; applied: number }
  | { ok: false; error: 'BAD_MOVE' | 'NO_MATERIAL' | 'INSUFFICIENT' | 'CONTENTION'; materialId?: string }

/**
 * 对一张单据应用一组库存变动：写确定性流水 + CAS 改 materials.stock。全有或全无——任一行失败即
 * 回滚本次已应用行（删其流水 + 反向 CAS），返回失败原因；重放同一单据（同 docType+docId）天然幂等。
 */
export async function applyStockMoves(moves: StockMove[], doc: MoveDoc): Promise<ApplyResult> {
  // fail-closed 入参校验（根因#8 假数据不入账）：整数、非零、料号非空、单据号非空
  if (!doc || !doc.docType || !doc.docId) return { ok: false, error: 'BAD_MOVE' }
  if (!Array.isArray(moves) || !moves.length) return { ok: false, error: 'BAD_MOVE' }
  for (const m of moves) {
    if (!m || !m.materialId || typeof m.materialId !== 'string') return { ok: false, error: 'BAD_MOVE' }
    if (!Number.isInteger(m.delta) || m.delta === 0) return { ok: false, error: 'BAD_MOVE', materialId: m.materialId }
  }

  const db = getDb()
  const ledger = db.collection(COLLECTIONS.stockLedger)
  const mats = db.collection(COLLECTIONS.materials)
  const done: StockMove[] = [] // 本次真正应用（拿到流水 claim 且改了库存）的行，失败时回滚

  const rollback = async () => {
    for (const m of done) {
      await casChange(mats, m.materialId, -m.delta) // 反向恢复（刚改过·冲突概率低·尽力恢复）
      await ledger.doc(ledgerIdOf(doc.docType, doc.docId, m.materialId)).remove().catch(() => undefined)
    }
  }

  let applied = 0
  for (const m of moves) {
    const _id = ledgerIdOf(doc.docType, doc.docId, m.materialId)
    // ① 流水 claim（确定性 _id·撞 id=已应用过·幂等跳过）
    let claimed = true
    try {
      await ledger.add({ data: { _id, itemKey: m.materialId, delta: m.delta, docType: doc.docType, docId: doc.docId, operator: doc.operator || '', reason: doc.reason || '', at: Date.now() } })
    } catch {
      claimed = false // DUPLICATE_ID：该行已入账（重放/并发方），跳过库存变更
    }
    if (!claimed) continue
    // ② CAS 改余额（fg: 成品行不动 materials——成品账在 kit/inventory，流水行只留痕）
    if (!m.materialId.startsWith('fg:')) {
      const r = await casChange(mats, m.materialId, m.delta)
      if (r !== 'ok') {
        await ledger.doc(_id).remove().catch(() => undefined) // 撤回本行 claim
        await rollback()
        return { ok: false, error: r, materialId: m.materialId }
      }
    }
    done.push(m)
    applied++
  }
  return { ok: true, applied }
}

/** 单料 CAS 变更：读 stock → 条件 where({_id, stock}) 绝对值写回；余额不为负；主档缺失 fail-closed。 */
async function casChange(coll: any, materialId: string, delta: number): Promise<'ok' | 'NO_MATERIAL' | 'INSUFFICIENT' | 'CONTENTION'> {
  for (let i = 0; i < CAS_RETRY; i++) {
    const got = await coll.doc(materialId).get().catch(() => null)
    if (!got || !got.data) return 'NO_MATERIAL'
    const cur = got.data.stock
    if (!Number.isInteger(cur)) {
      // 主档缺/坏 stock 字段（建档点恒写 0·此为历史/手工档兜底）：where 条件含 undefined 行为不可信，
      // 先一次性归零初始化再重试（绝对值写·并发双归零无害）
      await coll.doc(materialId).update({ data: { stock: 0 } }).catch(() => undefined)
      continue
    }
    const next = cur + delta
    if (next < 0) return 'INSUFFICIENT'
    const r = await coll
      .where({ _id: materialId, stock: cur })
      .update({ data: { stock: next, updatedAt: Date.now() } })
      .catch(() => ({ stats: { updated: 0 } }))
    if (r.stats && r.stats.updated === 1) return 'ok'
    // updated:0＝并发改动→重读重试
  }
  return 'CONTENTION' // 争用耗尽（管理端低频·几乎不至）——宁不动账勿错账
}

/** 读流水（管理端查账·bounded）：可按料号过滤，按时间倒序，limit 封顶。 */
export async function listStockLedger(materialId?: string, limit = 50): Promise<any[]> {
  const db = getDb()
  const cap = Math.min(Math.max(1, limit | 0), 200)
  let q: any = db.collection(COLLECTIONS.stockLedger)
  if (materialId) q = q.where({ itemKey: String(materialId) })
  const r = await q.orderBy('at', 'desc').limit(cap).get().catch(() => ({ data: [] }))
  return r.data || []
}

/** 某类流水按 itemKey 分组求和（管理端只读汇总·产销统计用·DB aggregate 不封顶精确不近似）。 */
export async function sumLedgerByItemKey(docType: MoveDocType): Promise<{ itemKey: string; total: number }[]> {
  const db = getDb()
  const $ = db.command.aggregate
  const r = await db
    .collection(COLLECTIONS.stockLedger)
    .aggregate()
    .match({ docType })
    .group({ _id: '$itemKey', total: $.sum('$delta') })
    .end()
    .catch(() => ({ list: [] }))
  return (r.list || []).map((x: any) => ({ itemKey: x._id, total: x.total }))
}

// ── 物料主档持久化（同在门1：materials 集合全库仅本文件读写·守卫 material-stock-single-seam）──
// 主档字段与库存字段分治：saveMaterialDoc 只写主档字段（name/category/uom/…），**绝不碰 stock**
// （建档初始化 stock:0 除外）；库存只经 applyStockMoves。uom 建档锁死（守卫 scm-uom-integer 行为锁）。

export interface MaterialDoc {
  _id: string // 确定性料号（action 层按命名契约推导）
  name: string
  category: 'yarn' | 'packaging' | 'card' | 'accessory'
  uom: 'count' | 'gram'
  supplierId?: string
  threshold?: number
  active?: boolean
  spec?: Record<string, string> // 毛线的 color/tier/form 快照（列表展示用·真相在 _id）
}

export async function saveMaterialDoc(m: MaterialDoc): Promise<'ok' | 'UOM_LOCKED'> {
  const db = getDb()
  const coll = db.collection(COLLECTIONS.materials)
  const fields: Record<string, unknown> = {
    name: m.name,
    category: m.category,
    uom: m.uom,
    supplierId: m.supplierId || '',
    threshold: Number.isInteger(m.threshold) && (m.threshold as number) >= 0 ? m.threshold : 0,
    active: m.active !== false,
    updatedAt: Date.now(),
  }
  if (m.spec) fields.spec = m.spec
  const got = await coll.doc(m._id).get().catch(() => null)
  if (got && got.data) {
    if (got.data.uom && got.data.uom !== m.uom) return 'UOM_LOCKED' // 计量方式建档锁死（改了=两本单位混账）
    await coll.doc(m._id).update({ data: fields }) // 不含 stock——库存只经 applyStockMoves
  } else {
    await coll.add({ data: { _id: m._id, ...fields, stock: 0 } }) // 建档初始化 stock:0（casChange 依赖整数余额）
  }
  return 'ok'
}

/** 读物料主档（管理端·bounded·主档量小）。 */
export async function listMaterialDocs(limit = 500): Promise<any[]> {
  const db = getDb()
  const cap = Math.min(Math.max(1, limit | 0), 500)
  const r = await db.collection(COLLECTIONS.materials).limit(cap).get().catch(() => ({ data: [] }))
  return r.data || []
}

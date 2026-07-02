import { reply, type Ctx } from '../lib'
import { COLLECTIONS, applyStockMoves, listMaterialDocs, transition } from '../../../../kit'
import { asFen, OUTWORK_ORDER_STATUS } from '@luckyducky/shared'

// 进销存车道 B·外协线（蓝图 docs/进销存ERP/施工蓝图.md §4B·门5 文件级隔离：本文件=车道 B 全部 action）。
// 业务定稿（README 需求）：织女把起手结做在**最大团**毛线上——发最大团原团（按色）→ 收同色带结团入库 →
// 损耗=发−收可见 → 计件工钱应付（收回数×单价）→ 结算销账。
// 出入库只经门1 kit/scmStock.applyStockMoves（守卫 material-stock-single-seam）；状态只走门2 transition()
// 且边全在 shared/scm.spec.ts 声明内（守卫 order-transitions-declared 按 scm*.ts 前缀自动对账本文件）。
// RBAC：不登记 ACTION_CAPS → 默认拒 admin:write＝仅超管（外包坐席天然无权）；写类 action 自动审计（shouldAudit）。
// 金额纪律：pieceRateFen / payableFen 全链整数「分」（Fen·根因#4）；数量一律正整数（团数·守卫 scm-uom-integer 纪律）。

// 料号命名契约（与 shared/scmBom yarnMaterialId 同源）：发料只收最大团原团、收货只收同色最大团带结（业务定稿）
const L_RAW = /^yarn:([a-z][a-z0-9-]*):L:raw$/
const L_KNOTTED = /^yarn:([a-z][a-z0-9-]*):L:knotted$/

// 集合名一律写字面量 'outworkOrders'（非 COLLECTIONS.x/常量）：order-transitions-declared 守卫按字面量
// 归属集合对账 transition 边与 status 写入——用变量会让本文件逃出对账面（known-collections-only 另核字面量在册）

/** 行清洗：[{materialId,qty}] → 白名单字段 + qty 正整数校验。返回 null＝形状非法（fail-closed）。 */
function cleanLines(raw: any): Array<{ materialId: string; qty: number }> | null {
  if (!Array.isArray(raw) || !raw.length) return null
  const seen = new Set<string>()
  const out: Array<{ materialId: string; qty: number }> = []
  for (const l of raw) {
    if (!l || typeof l.materialId !== 'string' || !l.materialId) return null
    if (seen.has(l.materialId)) return null // 同料号重复行＝入参糊（合并该由前端做·fail-closed 不猜语义）
    seen.add(l.materialId)
    if (!Number.isInteger(l.qty) || l.qty <= 0) return null
    out.push({ materialId: l.materialId, qty: l.qty })
  }
  return out
}

/** 物料主档在册集合（主档量小·bounded 500·同 saveMaterial 口径经门1 只读出口）。 */
async function knownMaterialIds(): Promise<Set<string>> {
  return new Set((await listMaterialDocs(500)).map((m: any) => String(m._id)))
}

// ── 列表（bounded ≤200·可按 status/workerId 过滤·倒序）──

export async function listOutworks({ db, data }: Ctx) {
  const cap = Math.min(Math.max(1, Number.isInteger(data && data.limit) ? data.limit : 100), 200)
  const where: Record<string, string> = {}
  const status = String((data && data.status) || '')
  if (status) {
    if (!(Object.values(OUTWORK_ORDER_STATUS) as string[]).includes(status)) return reply(400, { ok: false, error: 'BAD_STATUS' })
    where.status = status
  }
  const workerId = String((data && data.workerId) || '')
  if (workerId) where.workerId = workerId
  let q: any = db.collection('outworkOrders')
  if (Object.keys(where).length) q = q.where(where)
  const r = await q.orderBy('createdAt', 'desc').limit(cap).get().catch(() => ({ data: [] }))
  return reply(200, { ok: true, list: r.data || [] })
}

// ── 建/改草稿（仅 draft 可改）──

export async function saveOutwork({ db, data, agentId }: Ctx) {
  const outworkId = String(data.outworkId || '')
  const workerId = String(data.workerId || '')
  if (!workerId) return reply(400, { ok: false, error: 'NO_WORKER' })
  // 计件单价：非负整数「分」（0 允许=义务工/试做；元→分转换在 admin 边界一次·这里只收整数分）
  const pieceRateFen = data.pieceRateFen
  if (!Number.isInteger(pieceRateFen) || pieceRateFen < 0) return reply(400, { ok: false, error: 'BAD_RATE' })

  // 发料行：仅最大团原团（业务定稿只有最大团做起手结）+ qty 正整数 + 主档在册（fail-closed 不发无档料）
  const lines = cleanLines(data.issueLines)
  if (!lines) return reply(400, { ok: false, error: 'BAD_LINES' })
  for (const l of lines) {
    if (!L_RAW.test(l.materialId)) return reply(400, { ok: false, error: 'ISSUE_L_RAW_ONLY', materialId: l.materialId })
  }
  const known = await knownMaterialIds()
  for (const l of lines) {
    if (!known.has(l.materialId)) return reply(400, { ok: false, error: 'NO_MATERIAL', materialId: l.materialId })
  }

  // 织女档校验：workerId 须在 suppliers 且 type=outworker（发料对象是人·不是厂家）
  const worker = await db.collection(COLLECTIONS.suppliers).doc(workerId).get().catch(() => null)
  if (!worker || !worker.data) return reply(404, { ok: false, error: 'NO_WORKER' })
  if (worker.data.type !== 'outworker') return reply(400, { ok: false, error: 'NOT_OUTWORKER' })

  const fields = {
    workerId,
    issueLines: lines,
    pieceRateFen: asFen(pieceRateFen),
    updatedAt: Date.now(),
  }
  const coll = db.collection('outworkOrders')
  if (outworkId) {
    // 仅 draft 可改：条件更新绑 status（发料后单据是账目依据·改行=改已出库事实,不允许）
    const r = await coll.where({ _id: outworkId, status: 'draft' }).update({ data: fields }).catch(() => ({ stats: { updated: 0 } }))
    if (!r.stats || r.stats.updated !== 1) {
      const got = await coll.doc(outworkId).get().catch(() => null)
      return got && got.data ? reply(409, { ok: false, error: 'NOT_DRAFT' }) : reply(404, { ok: false, error: 'NO_OUTWORK' })
    }
    return reply(200, { ok: true, outworkId })
  }
  const added = await coll.add({ data: { ...fields, status: 'draft', createdAt: Date.now(), createdBy: agentId || 'admin' } })
  return reply(200, { ok: true, outworkId: added.id || added._id || '' })
}

// ── 发料（draft→issued·首次流转绑出库副作用）──

export async function issueOutwork({ db, data, agentId }: Ctx) {
  const outworkId = String(data.outworkId || '')
  if (!outworkId) return reply(400, { ok: false, error: 'NO_OUTWORK' })
  const r = await transition('outworkOrders', outworkId, ['draft'], 'issued', { issuedAt: Date.now() })
  if (!r.doc) return reply(404, { ok: false, error: 'NO_OUTWORK' })
  if (!r.moved) return reply(409, { ok: false, error: 'NOT_DRAFT' }) // 重放/并发方已流转——无副作用（幂等）

  // 首次流转赢家执行出库（每行负 delta·流水 _id=outwork_issue:<单据>:<料号> 确定性幂等）
  const moves = (r.doc.issueLines || []).map((l: any) => ({ materialId: l.materialId, delta: -l.qty }))
  const ar = await applyStockMoves(moves, { docType: 'outwork_issue', docId: outworkId, operator: agentId || 'admin' })
  if (!ar.ok) {
    // 补偿回滚（宁不动账勿错账）：库存不足/主档缺/争用时 applyStockMoves 已内部回滚全部行（全有或全无·账没动），
    // 但状态已被上面 transition 抢占成 issued——须复原 draft,否则单据「已发料」而库存一件没出（账实必偏且无法重试）。
    // 用条件更新而非 transition()：issued→draft 是本次未完成发料的技术性复原,不是业务逆向流转（蓝图定稿 MVP
    // 不做逆向流转,scm.spec 故意不声明这条边——声明了就开放成业务动作了）；条件绑 status:'issued' 防覆盖并发方
    // （若有人已 receiveOutwork 翻 delivered,此处 no-op,错误照返、人工经调整单对账）。
    await db
      .collection('outworkOrders')
      .where({ _id: outworkId, status: 'issued' })
      .update({ data: { status: 'draft', issuedAt: null } })
      .catch(() => undefined)
    return reply(ar.error === 'INSUFFICIENT' ? 409 : 400, { ok: false, error: ar.error, materialId: ar.materialId })
  }
  return reply(200, { ok: true, applied: ar.applied })
}

// ── 收货（issued→delivered·入带结 + 同一次条件更新定格 payableFen/lossQty）──

export async function receiveOutwork({ db, data, agentId }: Ctx) {
  const outworkId = String(data.outworkId || '')
  if (!outworkId) return reply(400, { ok: false, error: 'NO_OUTWORK' })
  const got = await db.collection('outworkOrders').doc(outworkId).get().catch(() => null)
  if (!got || !got.data) return reply(404, { ok: false, error: 'NO_OUTWORK' })
  const order = got.data
  if (order.status !== 'issued') return reply(409, { ok: false, error: 'NOT_ISSUED' }) // 含重放（已 delivered）——无副作用

  const lines = cleanLines(data.receiveLines)
  if (!lines) return reply(400, { ok: false, error: 'BAD_LINES' })

  // 发料对照表：颜色 → 发出团数（收货只能是发过的颜色、每色收 ≤ 发·防收比发多/凭空入库）
  const issuedByColor = new Map<string, number>()
  for (const l of order.issueLines || []) {
    const m = L_RAW.exec(String(l.materialId))
    if (m) issuedByColor.set(m[1], (issuedByColor.get(m[1]) || 0) + l.qty)
  }
  for (const l of lines) {
    const m = L_KNOTTED.exec(l.materialId)
    if (!m) return reply(400, { ok: false, error: 'RECEIVE_L_KNOTTED_ONLY', materialId: l.materialId }) // 收回的只能是带结最大团
    const issued = issuedByColor.get(m[1])
    if (!issued) return reply(400, { ok: false, error: 'COLOR_NOT_ISSUED', materialId: l.materialId }) // 颜色 ⊆ 发料颜色
    if (l.qty > issued) return reply(400, { ok: false, error: 'RECEIVE_EXCEEDS_ISSUE', materialId: l.materialId })
  }
  // 带结料号主档预检（fail-closed·不静默建档）：带结团往往在收第一批货前还没建档——缺档在**流转前**拒，
  // 否则 transition 赢了再发现缺档就得走补偿；uom/供应商等主档语义该在物料页人工定,不由收货动作偷偷替定。
  const known = await knownMaterialIds()
  for (const l of lines) {
    if (!known.has(l.materialId))
      return reply(400, { ok: false, error: 'NO_MATERIAL', materialId: l.materialId, hint: '带结团料号未建档——先在物料页建带结团档再收货' })
  }

  // 定格应付与损耗（整数分/整数团·收货时点即锁死,结算/对账不重算）：payable=Σ收×计件单价；loss=Σ发−Σ收
  const rate = order.pieceRateFen
  if (!Number.isInteger(rate) || rate < 0) return reply(400, { ok: false, error: 'BAD_RATE' }) // 不信库内旧数据（脏档早暴露）
  const receivedQty = lines.reduce((s, l) => s + l.qty, 0)
  const issuedQty = (order.issueLines || []).reduce((s: number, l: any) => s + l.qty, 0)
  const payableFen = asFen(receivedQty * rate)
  const lossQty = issuedQty - receivedQty // 每色收≤发 ⇒ 恒 ≥0

  // 流转 + 定格同一次条件更新（不可分两步：分开则「翻了状态没定格金额」的窗口会让结算读到空应付）
  const r = await transition('outworkOrders', outworkId, ['issued'], 'delivered', {
    receiveLines: lines,
    payableFen,
    lossQty,
    deliveredAt: Date.now(),
  })
  if (!r.moved) return reply(409, { ok: false, error: 'NOT_ISSUED' }) // 并发方抢先——无副作用（幂等）

  const ar = await applyStockMoves(
    lines.map((l) => ({ materialId: l.materialId, delta: l.qty })),
    { docType: 'outwork_receive', docId: outworkId, operator: agentId || 'admin' }
  )
  if (!ar.ok) {
    // 补偿回滚（对称 issueOutwork·理由同上）：入库失败（主档并发被删/CAS 争用耗尽·预检后几乎不至）时
    // 复原 issued 并清掉本次定格,否则单据「已收货有应付」而带结一团没入账、重放又被 NOT_ISSUED 挡死。
    await db
      .collection('outworkOrders')
      .where({ _id: outworkId, status: 'delivered' })
      .update({ data: { status: 'issued', receiveLines: null, payableFen: null, lossQty: null, deliveredAt: null } })
      .catch(() => undefined)
    return reply(ar.error === 'CONTENTION' ? 409 : 400, { ok: false, error: ar.error, materialId: ar.materialId })
  }
  return reply(200, { ok: true, payableFen, lossQty, applied: ar.applied })
}

// ── 结算（delivered→settled·工钱付清销账）──

export async function settleOutwork({ data }: Ctx) {
  const outworkId = String(data.outworkId || '')
  if (!outworkId) return reply(400, { ok: false, error: 'NO_OUTWORK' })
  const r = await transition('outworkOrders', outworkId, ['delivered'], 'settled', { settledAt: Date.now() })
  if (!r.doc) return reply(404, { ok: false, error: 'NO_OUTWORK' })
  if (!r.moved) return reply(409, { ok: false, error: 'NOT_DELIVERED' })
  return reply(200, { ok: true })
}

// ── 取消（仅 draft·已发料不可取消,异常走物料页调整单·蓝图定稿）──

export async function cancelOutwork({ data }: Ctx) {
  const outworkId = String(data.outworkId || '')
  if (!outworkId) return reply(400, { ok: false, error: 'NO_OUTWORK' })
  const r = await transition('outworkOrders', outworkId, ['draft'], 'cancelled', { cancelledAt: Date.now() })
  if (!r.doc) return reply(404, { ok: false, error: 'NO_OUTWORK' })
  if (!r.moved) return reply(409, { ok: false, error: 'NOT_DRAFT' })
  return reply(200, { ok: true })
}

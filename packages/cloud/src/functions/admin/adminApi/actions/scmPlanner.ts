import { reply, type Ctx } from '../lib'
import { COLLECTIONS, listMaterialDocs, sumLedgerByItemKey } from '../../../../kit'
import { resolveBom, yarnMaterialId } from '@luckyducky/shared'

// 进销存 SCM-D 备货计算器（蓝图 docs/进销存ERP/ §4D·门5 文件级隔离：本文件=车道 D 计划面）。
// **只读**：目标套数 × 门3 resolveBom（与组装同一解析·配方语义单源）→ 对比主档库存 → 缺口两分：
//   ① 外协缺口——带结团不外购（业务定稿：带结=织女产出），缺多少带结＝应发多少同色 L 原团；
//     派生的原团需求叠回采购口径（发出去的原团也是要备的料）。
//   ② 采购缺口——按供应商分列（够扣不出行·未建档料点名+归「未挂供应商」组）。
// fail-closed：无模板/无差异位/坏 targets 即拒（不静默补默认·根因#8）。RBAC：默认拒 admin:write＝仅超管。
// getFgSummary 同车道另一只读视角：不算缺口，是 stockLedger fg 流水事后按产品汇总（打包累计/发货累计），不动账。

const KNOTTED_RE = /^yarn:([a-z][a-z0-9-]*):L:knotted$/

export async function getRestockPlan({ db, data }: Ctx) {
  const targets = Array.isArray(data.targets) ? data.targets : []
  if (!targets.length || targets.length > 50) return reply(400, { ok: false, error: 'BAD_TARGETS' })
  for (const t of targets) {
    if (!t || !t.productId || !Number.isInteger(t.sets) || t.sets <= 0) return reply(400, { ok: false, error: 'BAD_TARGETS' })
  }
  const tDoc = await db.collection(COLLECTIONS.config).doc('scmBomTemplate').get().catch(() => null)
  if (!tDoc || !tDoc.data) return reply(400, { ok: false, error: 'NO_TEMPLATE' })
  const { _id: _omit, updatedAt: _omit2, ...template } = tDoc.data as Record<string, any>

  // 聚合需求：Σ各产品 resolveBom（同料号跨产品累加）
  const need = new Map<string, number>()
  for (const t of targets) {
    const p = await db.collection(COLLECTIONS.bomProfiles).doc(String(t.productId)).get().catch(() => null)
    if (!p || !p.data) return reply(400, { ok: false, error: 'NO_PROFILE', productId: String(t.productId) })
    const r = resolveBom(template as any, p.data, t.sets)
    if (!r.ok) return reply(400, { ok: false, error: r.error, productId: String(t.productId) })
    for (const l of r.lines) need.set(l.materialId, (need.get(l.materialId) || 0) + l.qty)
  }

  const byId = new Map((await listMaterialDocs()).map((m: any) => [m._id, m])) // 主档经门1 只读出口
  const stockOf = (id: string): number => {
    const m: any = byId.get(id)
    return m && Number.isInteger(m.stock) ? m.stock : 0
  }

  // ① 外协缺口：带结缺口 → 应送同色 L 原团（1 原团织 1 带结·蓝图动线）·派生原团需求叠进采购口径
  const outworkGaps: any[] = []
  for (const [id, n] of [...need.entries()]) {
    const m = KNOTTED_RE.exec(id)
    if (!m) continue
    const gap = Math.max(0, n - stockOf(id))
    if (gap <= 0) continue
    const rawId = yarnMaterialId(m[1], 'L', 'raw')
    need.set(rawId, (need.get(rawId) || 0) + gap)
    outworkGaps.push({ color: m[1], knottedNeed: n, knottedStock: stockOf(id), gap, rawToIssue: gap })
  }

  // ② 采购缺口：非带结料 need−stock>0 出行·按供应商分组；未建档点名（gap=全量需求·归未挂组）
  const groups = new Map<string, any>()
  const missingMaterials: string[] = []
  for (const [id, n] of [...need.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (KNOTTED_RE.test(id)) continue // 带结不外购（外协产出）
    const m: any = byId.get(id)
    if (!m) missingMaterials.push(id)
    const stock = stockOf(id)
    const gap = Math.max(0, n - stock)
    if (gap <= 0) continue
    const supplierId = (m && m.supplierId) || ''
    if (!groups.has(supplierId)) groups.set(supplierId, { supplierId, lines: [] })
    groups.get(supplierId).lines.push({ materialId: id, name: (m && m.name) || id, uom: (m && m.uom) || 'count', need: n, stock, gap, missing: !m })
  }
  const sups = await db.collection(COLLECTIONS.suppliers).limit(200).get().catch(() => ({ data: [] }))
  const supName = new Map((sups.data || []).map((s: any) => [s._id, s.name]))
  const purchaseGroups = [...groups.values()].map((g) => ({ ...g, supplierName: supName.get(g.supplierId) || (g.supplierId || '未挂供应商') }))
  return reply(200, { ok: true, outworkGaps, purchaseGroups, missingMaterials })
}

/** 拆 fg 流水的 itemKey（`fg:${productId}__${spec}`）回 productId/spec，供产销统计展示用。 */
function parseFgKey(itemKey: string): { productId: string; spec: string } {
  const s = itemKey.slice(3) // 去掉 'fg:' 前缀
  const i = s.indexOf('__')
  return i < 0 ? { productId: s, spec: '' } : { productId: s.slice(0, i), spec: s.slice(i + 2) }
}

/** 产销统计（只读）：stockLedger 里 assembly_in（打包产出）/ ship（发货核销）两类 fg 流水按 itemKey 汇总——
 * 回应「一共打包/卖出多少」，不产生任何新写入（对账口径见 scmAssembly.ts 注释：Σ成品流水 ⇄ inventory）。
 * 汇总经门1 kit/scmStock.sumLedgerByItemKey 读（守卫 material-stock-single-seam：stockLedger 全库仅门1 读写）。 */
export async function getFgSummary(_ctx: Ctx) {
  const [packed, shipped] = await Promise.all([sumLedgerByItemKey('assembly_in'), sumLedgerByItemKey('ship')])
  return reply(200, {
    ok: true,
    packed: packed.map((r) => ({ ...parseFgKey(r.itemKey), qty: r.total })),
    shipped: shipped.map((r) => ({ ...parseFgKey(r.itemKey), qty: -r.total })), // delta 存负数（出库），展示转正
  })
}

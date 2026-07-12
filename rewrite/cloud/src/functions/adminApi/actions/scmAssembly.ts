import { reply, str, type Ctx } from '../lib'
import { applyStockMoves, produceStock, listMaterialDocs, notifyAlert, pageQuery } from '../../../kit'
import { COLLECTIONS } from '@ldrw/shared'
import { resolveBom } from '@ldrw/shared'

// 进销存 SCM-C 组装执行（蓝图 docs/进销存ERP/·门5 文件级隔离：本文件=车道 C 组装面）。
// 组装单**单步执行**（建即执行·无状态机·撤销走调整单——CLAUDE §7 别为不存在的草稿需求建状态机）：
//   门3 resolveBom 解析 → **快照冻结**存单（bomSnapshot/consumedLines·历史单不追新·守卫 bom-snapshot-frozen）
//   → 门1 applyStockMoves 扣原料（assembly_out·all-or-nothing）→ 门4 produceStock 入成品（kit/inventory 唯一出口）
//   → assembly_in fg 流水留痕（对账公式 Σ成品流水 ⇄ inventory 的一半）。
// 幂等：assemblyId 由前端每次提交生成一次、重试复用；单据 _id=assemblyId 确定性 claim——撞 id=已执行过（409 不双扣）。
// RBAC：不登记 ACTION_CAPS → 默认拒 admin:write＝仅超管；写类自动审计（shouldAudit）。

/** 读模板+差异位（组装/预演共用·fail-closed：缺一即拒，不静默补默认）。 */
async function loadBom(db: any, productId: string): Promise<{ template?: any; profile?: any; error?: string }> {
  const p = await db.collection(COLLECTIONS.bomProfiles).doc(productId).get().catch(() => null)
  if (!p || !p.data) return { error: 'NO_PROFILE' }
  const t = await db.collection(COLLECTIONS.config).doc('scmBomTemplate').get().catch(() => null)
  if (!t || !t.data) return { error: 'NO_TEMPLATE' }
  const { _id: _omit, updatedAt: _omit2, ...template } = t.data as Record<string, any>
  return { template, profile: p.data }
}

/** 组装执行：产品×规格×套数 → 扣原料入成品，全程留痕。 */
export async function runAssembly({ db, data, agentId }: Ctx) {
  const assemblyId = String(data.assemblyId || '') // 前端每次提交生成一次·重试复用＝幂等键
  const productId = String(data.productId || '')
  const spec = str(data.spec, 40) // 成品 SKU 规格（与 inventory/order.items[].spec 同键·可空）
  if (!assemblyId || !productId) return reply(400, { ok: false, error: 'BAD_ARGS' })
  const sets = data.sets
  if (!Number.isInteger(sets) || sets <= 0) return reply(400, { ok: false, error: 'BAD_SETS' })
  const loaded = await loadBom(db, productId)
  if (loaded.error) return reply(400, { ok: false, error: loaded.error })
  const r = resolveBom(loaded.template, loaded.profile, sets)
  if (!r.ok) return reply(400, { ok: false, error: r.error })
  const operator = agentId || 'admin'

  // ① claim：单据确定性 _id=assemblyId（撞 id=已执行过·并发/重试幂等）。快照在此冻结——
  //    执行后改模板不回写历史单（守卫 bom-snapshot-frozen·同订单快照原则）。
  const coll = db.collection(COLLECTIONS.assemblyOrders)
  try {
    await coll.add({
      data: {
        _id: assemblyId,
        productId,
        spec,
        sets,
        bomSnapshot: { template: loaded.template, profile: { yarnColors: loaded.profile.yarnColors, packagingMaterialId: loaded.profile.packagingMaterialId, cardMaterialId: loaded.profile.cardMaterialId } },
        consumedLines: r.lines,
        operator,
        at: Date.now(),
      },
    })
  } catch {
    return reply(409, { ok: false, error: 'DUPLICATE' }) // 已执行过（重放/并发方）·不双扣
  }

  // ② 门1 扣原料（all-or-nothing·任一料不足即整单回滚）；失败撤回 claim——账没动，修完库存可重试
  const out = await applyStockMoves(
    r.lines.map((l) => ({ materialId: l.materialId, delta: -l.qty })),
    { docType: 'assembly_out', docId: assemblyId, operator }
  )
  if (!out.ok) {
    // 撤 claim 失败留痕（N3·bug 清除战役 II 遗留·病根14）：失败会留孤 claim 文档，重试永远撞 DUPLICATE
    // （库存没扣却被判已执行）——只加信号，返回语义/控制流零变化（原 409/400 回复不变）。
    await coll
      .doc(assemblyId)
      .remove()
      .catch(async () => {
        await notifyAlert('anomaly', 'runAssembly', 'CLAIM_ROLLBACK_FAIL', { assemblyId })
      })
    return reply(out.error === 'INSUFFICIENT' ? 409 : 400, { ok: false, error: out.error, materialId: out.materialId })
  }

  // ③ 门4 入成品（kit/inventory 唯一新增出口·无文档则建·不限量保持不限量）
  const prod = await produceStock(productId, spec, sets)
  if (!prod.ok) {
    // 争用耗尽（管理端低频·几乎不至）：原料已扣、成品未入——诚实报错不写 assembly_in 流水（不留假痕），
    // 单据保留供追查，人工经「期初盘点/调整」对平（撤销走调整单·蓝图 §1）。
    return reply(500, { ok: false, error: 'PRODUCE_FAIL' })
  }
  // ④ assembly_in 成品流水留痕（fg 行只留痕不动 materials·对账公式 Σ成品流水 ⇄ inventory）。
  // fail-soft 但不静默（病根#14）：库存已在③入账正确，流水缺痕只坏对账可溯性；重试会撞 assemblyId 幂等闸
  // 补不回来，故失败必留痕——走 kit observe 单出口（同 ship ledger 口径），人工经期初调整对平。
  const fin = await applyStockMoves([{ materialId: `fg:${productId}__${spec}`, delta: sets }], { docType: 'assembly_in', docId: assemblyId, operator }).catch(
    () => ({ ok: false as const })
  )
  if (!fin.ok) await notifyAlert('anomaly', 'runAssembly', 'ASSEMBLY_LEDGER_FAIL', { assemblyId })
  return reply(200, { ok: true, sets, consumed: r.lines })
}

/** 只读预演：这批打包要扣什么料、库存够不够（不动账·打包页确认用）。 */
export async function previewAssembly({ db, data }: Ctx) {
  const productId = String(data.productId || '')
  const sets = data.sets
  if (!productId || !Number.isInteger(sets) || sets <= 0) return reply(400, { ok: false, error: 'BAD_SETS' })
  const loaded = await loadBom(db, productId)
  if (loaded.error) return reply(400, { ok: false, error: loaded.error })
  const r = resolveBom(loaded.template, loaded.profile, sets)
  if (!r.ok) return reply(400, { ok: false, error: r.error })
  const byId = new Map((await listMaterialDocs()).map((m: any) => [m._id, m])) // 读主档经门1（kit/scmStock）
  const lines = r.lines.map((l) => {
    const m: any = byId.get(l.materialId)
    const stock = m && Number.isInteger(m.stock) ? m.stock : 0
    return { materialId: l.materialId, name: (m && m.name) || l.materialId, uom: (m && m.uom) || 'count', need: l.qty, stock, short: Math.max(0, l.qty - stock), missing: !m }
  })
  return reply(200, { ok: true, lines })
}

/** 组装单列表（管理端查账·cursor 分页·倒序）。B1（根因#7）：改走 kit pageQuery——旧 limit 直取封顶
 *  会让超上限历史单永久不可查；defaultLimit 沿用旧默认值 50，无参调用首页条数零变化。 */
export async function listAssemblies({ db, data }: Ctx) {
  const paged = await pageQuery(db, COLLECTIONS.assemblyOrders, {}, 'at', data, 50)
  return reply(200, { ok: true, list: paged.list, nextCursor: paged.nextCursor, hasMore: paged.hasMore })
}

import { reply, type Ctx } from '../lib'
import { COLLECTIONS } from '../../../../kit'

// 进销存 SCM-C 配方管理（蓝图 docs/进销存ERP/·门5 文件级隔离：本文件=车道 C 配方面）。
// 全局一张模板存 config 确定性 _id='scmBomTemplate'（复用配置单源模式·不立新集合）；每产品差异位存
// bomProfiles（_id=productId·三色 + 专属包装/卡片料号）。配方语义单源在 shared/scmBom resolveBom（门3）——
// 本文件只管「存取 + 白名单校验」，不解析。RBAC：不登记 ACTION_CAPS → 默认拒 admin:write＝仅超管。

const SLUG = /^[a-z][a-z0-9-]*$/ // 颜色 slug（与 scmMaterials 料号成分同契约）

// 模板白名单清洗（镜像门3 resolveBom 的校验口径·非法即拒——fail-closed 不静默修，防脏模板入库后组装才炸）
function cleanTemplate(t: any): { commonLines: any[]; yarnSlots: any[] } | null {
  if (!t || !Array.isArray(t.commonLines) || !Array.isArray(t.yarnSlots) || !t.yarnSlots.length) return null
  const commonLines: any[] = []
  for (const l of t.commonLines) {
    if (!l || !l.materialId || typeof l.materialId !== 'string') return null
    if (!Number.isInteger(l.qtyPerSet) || l.qtyPerSet <= 0) return null // 件/克/团数一律正整数
    commonLines.push({ materialId: String(l.materialId).slice(0, 80), qtyPerSet: l.qtyPerSet })
  }
  const yarnSlots: any[] = []
  for (const s of t.yarnSlots) {
    if (!s || !Number.isInteger(s.qtyPerSet) || s.qtyPerSet <= 0) return null
    if (s.tier !== 'L' && s.tier !== 'M' && s.tier !== 'S') return null
    if (s.form !== 'raw' && s.form !== 'knotted') return null
    if (s.form === 'knotted' && s.tier !== 'L') return null // 带结仅最大团（用户拍板）
    yarnSlots.push({ tier: s.tier, form: s.form, qtyPerSet: s.qtyPerSet })
  }
  return { commonLines, yarnSlots }
}

/** 配方一览（模板 + 全部产品差异位·bounded）。 */
export async function getBomSetup({ db }: Ctx) {
  const t = await db.collection(COLLECTIONS.config).doc('scmBomTemplate').get().catch(() => null)
  const { _id: _omit, updatedAt: _omit2, ...template } = (t?.data as Record<string, any>) || {}
  const p = await db.collection(COLLECTIONS.bomProfiles).limit(200).get().catch(() => ({ data: [] }))
  return reply(200, { ok: true, template: t?.data ? template : null, profiles: p.data || [] })
}

/** 保存全局模板（整存·模板就一张，数值＝业务数据 admin 填）。 */
export async function saveBomTemplate({ db, data }: Ctx) {
  const clean = cleanTemplate(data.template)
  if (!clean) return reply(400, { ok: false, error: 'BAD_TEMPLATE' })
  const next = { ...clean, updatedAt: Date.now() }
  const coll = db.collection(COLLECTIONS.config)
  // set data 不含 _id（真 SDK doc(id).set 的 data 带 _id 即 reject·守卫 no-id-in-set-data）
  await coll
    .doc('scmBomTemplate')
    .set({ data: next })
    .catch(async () => {
      await coll.add({ data: { _id: 'scmBomTemplate', ...next } })
    })
  return reply(200, { ok: true })
}

/** 保存产品差异位（_id=productId·三色 + 专属包装/卡片料号，全部必填）。 */
export async function saveBomProfile({ db, data }: Ctx) {
  const p = data.profile
  const productId = String((p && p.productId) || '').slice(0, 40)
  if (!productId) return reply(400, { ok: false, error: 'NO_PRODUCT' })
  const colors = (p && p.yarnColors) || {}
  for (const tier of ['L', 'M', 'S']) {
    if (!SLUG.test(String(colors[tier] || ''))) return reply(400, { ok: false, error: 'BAD_COLOR' }) // 三档颜色全要填
  }
  const packagingMaterialId = String((p && p.packagingMaterialId) || '')
  const cardMaterialId = String((p && p.cardMaterialId) || '')
  if (!packagingMaterialId || !cardMaterialId) return reply(400, { ok: false, error: 'NO_SPECIFIC' })
  const next = {
    yarnColors: { L: String(colors.L), M: String(colors.M), S: String(colors.S) },
    packagingMaterialId: packagingMaterialId.slice(0, 80),
    cardMaterialId: cardMaterialId.slice(0, 80),
    updatedAt: Date.now(),
  }
  const coll = db.collection(COLLECTIONS.bomProfiles)
  await coll
    .doc(productId)
    .set({ data: next })
    .catch(async () => {
      await coll.add({ data: { _id: productId, ...next } })
    })
  return reply(200, { ok: true, productId })
}

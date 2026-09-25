import { reply, type Ctx } from '../lib'
import { getDocOrNull, setOrAdd } from '../../../kit'
import { COLLECTIONS, cleanBomTemplate } from '@ldrw/shared'

// 进销存 SCM-C 配方管理（见 docs/业务逻辑架构.md 链 12·门5 文件级隔离：本文件=车道 C 配方面）。
// 全局一张模板存 config 确定性 _id='scmBomTemplate'（复用配置单源模式·不立新集合）；每产品差异位存
// bomProfiles（_id=productId·三色 + 专属包装/卡片料号）。配方语义单源在 shared/scmBom resolveBom（门3）——
// 本文件只管「存取」，白名单校验规则单源在 shared/scmBom cleanBomTemplate（此前本文件手写复刻过一份，
// 已改真导入复用，不再各背各的规则）。RBAC：不登记 ACTION_CAPS → 默认拒 admin:write＝仅超管。

const SLUG = /^[a-z][a-z0-9-]*$/ // 颜色 slug（与 scmMaterials 料号成分同契约）

/** 配方一览（模板 + 全部产品差异位·bounded）。 */
export async function getBomSetup({ db }: Ctx) {
  const t = await getDocOrNull(db.collection(COLLECTIONS.config).doc('scmBomTemplate'))
  const { _id: _omit, updatedAt: _omit2, ...template } = (t as Record<string, any>) || {}
  const p = await db.collection(COLLECTIONS.bomProfiles).limit(200).get()
  return reply(200, { ok: true, template: t ? template : null, profiles: p.data || [] })
}

/** 保存全局模板（整存·模板就一张，数值＝业务数据 admin 填）。 */
export async function saveBomTemplate({ db, data }: Ctx) {
  const clean = cleanBomTemplate(data.template)
  if (!clean) return reply(400, { ok: false, error: 'BAD_TEMPLATE' })
  const next = { ...clean, updatedAt: Date.now() }
  await setOrAdd(db.collection(COLLECTIONS.config), 'scmBomTemplate', next)
  return reply(200, { ok: true })
}

/** 保存产品差异位（_id=productId·三色 + 专属包装/卡片料号，全部必填）。 */
export async function saveBomProfile({ db, data }: Ctx) {
  const p = data.profile
  // trim 尾随/前导空格（D1·bug 清除批D）：不 trim 会把 'abc123 ' 落成幽灵 _id，真实产品 'abc123' 持续
  // 「未填差异位」、组装时 NO_PROFILE 拒绝，前端却已提示保存成功——契约不一致的静默数据错位。
  const productId = String((p && p.productId) || '').trim().slice(0, 40)
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
  await setOrAdd(db.collection(COLLECTIONS.bomProfiles), productId, next)
  return reply(200, { ok: true, productId })
}

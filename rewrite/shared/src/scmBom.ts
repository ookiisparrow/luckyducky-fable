/**
 * 配方解析纯函数（进销存 SCM-0 门3·蓝图 docs/进销存ERP/施工蓝图.md §3）。
 *
 * 业务事实（用户 2026-07-02 拍板）：所有产品构成几乎一致、数量重量完全相同 → **全局一张模板** +
 * 每产品三个填空（三档毛线颜色 + 专属包装料号 + 专属卡片料号）。最大团(L)用带结、中/小团(M/S)用原团。
 *
 * 组装（车道 C）与备货计算器（车道 D）共用本解析——配方语义只此一处（两车道共用＝真冲突面，
 * 故落地基；纯函数零 IO，模板/差异位由调用方读库后喂入）。料号命名契约与 kit/collections.ts 头注一致。
 */

export type YarnTier = 'L' | 'M' | 'S'
export type YarnForm = 'raw' | 'knotted'

/** 全局配方模板（存 config 集合确定性 _id='scmBomTemplate'·数值是业务数据 admin 填）。 */
export interface BomTemplate {
  /** 共用料（全产品一致）：料号 × 每套用量（件或克·整数·单位随主档 uom）。 */
  commonLines: ReadonlyArray<{ materialId: string; qtyPerSet: number }>
  /** 毛线槽×3：档位 × 形态 × 每套团数（颜色留空按产品填·L=knotted / M·S=raw）。 */
  yarnSlots: ReadonlyArray<{ tier: YarnTier; form: YarnForm; qtyPerSet: number }>
}

/** 每产品差异位（bomProfiles 集合·_id=productId）。 */
export interface BomProfile {
  yarnColors: { L: string; M: string; S: string }
  packagingMaterialId: string
  cardMaterialId: string
}

/** 毛线料号推导（命名契约·门3 依赖）：yarn:<color>:<tier>:<form>（knotted 仅 L 档合法）。 */
export function yarnMaterialId(color: string, tier: YarnTier, form: YarnForm): string {
  return `yarn:${color}:${tier}:${form}`
}

export type ResolveBomResult =
  | { ok: true; lines: Array<{ materialId: string; qty: number }> }
  | { ok: false; error: 'BAD_SETS' | 'BAD_TEMPLATE' | 'BAD_PROFILE' }

/**
 * 模板 × 差异位 × 套数 → 用料清单（同料号合并累加）。纯函数：入参非法即 fail-closed，
 * 不静默补默认（根因#8 假数据不入账）。
 */
export function resolveBom(template: BomTemplate, profile: BomProfile, sets: number): ResolveBomResult {
  if (!Number.isInteger(sets) || sets <= 0) return { ok: false, error: 'BAD_SETS' }
  if (!template || !Array.isArray(template.commonLines) || !Array.isArray(template.yarnSlots) || !template.yarnSlots.length)
    return { ok: false, error: 'BAD_TEMPLATE' }
  for (const l of template.commonLines) {
    if (!l || !l.materialId || !Number.isInteger(l.qtyPerSet) || l.qtyPerSet <= 0) return { ok: false, error: 'BAD_TEMPLATE' }
  }
  for (const s of template.yarnSlots) {
    if (!s || !Number.isInteger(s.qtyPerSet) || s.qtyPerSet <= 0) return { ok: false, error: 'BAD_TEMPLATE' }
    if (s.tier !== 'L' && s.tier !== 'M' && s.tier !== 'S') return { ok: false, error: 'BAD_TEMPLATE' }
    if (s.form !== 'raw' && s.form !== 'knotted') return { ok: false, error: 'BAD_TEMPLATE' }
    if (s.form === 'knotted' && s.tier !== 'L') return { ok: false, error: 'BAD_TEMPLATE' } // 带结仅最大团（用户拍板）
  }
  if (!profile || !profile.yarnColors || !profile.packagingMaterialId || !profile.cardMaterialId)
    return { ok: false, error: 'BAD_PROFILE' }
  const colorOf = (tier: YarnTier): string =>
    tier === 'L' ? profile.yarnColors.L : tier === 'M' ? profile.yarnColors.M : profile.yarnColors.S
  for (const s of template.yarnSlots) {
    if (!colorOf(s.tier)) return { ok: false, error: 'BAD_PROFILE' } // 模板要的档位颜色必须填
  }

  const acc = new Map<string, number>()
  const add = (materialId: string, qty: number) => acc.set(materialId, (acc.get(materialId) || 0) + qty)
  for (const l of template.commonLines) add(l.materialId, l.qtyPerSet * sets)
  for (const s of template.yarnSlots) add(yarnMaterialId(colorOf(s.tier), s.tier, s.form), s.qtyPerSet * sets)
  add(profile.packagingMaterialId, sets) // 专属槽：包装/卡片 每套 ×1（构成一致是业务事实·不做成配置）
  add(profile.cardMaterialId, sets)
  return { ok: true, lines: [...acc.entries()].map(([materialId, qty]) => ({ materialId, qty })) }
}

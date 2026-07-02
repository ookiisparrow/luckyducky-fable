import { describe, it, expect } from 'vitest'
import { resolveBom, yarnMaterialId } from '../../packages/shared/src/scmBom'

// 门3 配方解析纯函数行为锁（SCM-0·组装与备货计算器共用契约）：模板×差异位×套数 → 用料清单，
// 同料号合并、毛线料号按命名契约推导、带结仅最大团、入参非法 fail-closed。

const TEMPLATE = {
  commonLines: [
    { materialId: 'hook', qtyPerSet: 1 },
    { materialId: 'stuffing', qtyPerSet: 40 }, // 克
    { materialId: 'eyes', qtyPerSet: 2 },
  ],
  yarnSlots: [
    { tier: 'L', form: 'knotted', qtyPerSet: 1 }, // 最大团带结（用户拍板）
    { tier: 'M', form: 'raw', qtyPerSet: 1 },
    { tier: 'S', form: 'raw', qtyPerSet: 2 },
  ],
}
const PROFILE = { yarnColors: { L: 'yellow', M: 'white', S: 'orange' }, packagingMaterialId: 'pkg:p-duck', cardMaterialId: 'card:p-duck' }

describe('resolveBom（门3·纯函数）', () => {
  it('模板×差异位×套数：共用料/三色毛线/专属件全展开·数量=每套×sets', () => {
    const r = resolveBom(TEMPLATE, PROFILE, 50)
    expect(r.ok).toBe(true)
    const q = Object.fromEntries(r.lines.map((l) => [l.materialId, l.qty]))
    expect(q).toEqual({
      hook: 50,
      stuffing: 2000,
      eyes: 100,
      'yarn:yellow:L:knotted': 50,
      'yarn:white:M:raw': 50,
      'yarn:orange:S:raw': 100,
      'pkg:p-duck': 50,
      'card:p-duck': 50,
    })
  })

  it('同料号合并累加（共用料与专属件撞料号时不重复出行）', () => {
    const t = { ...TEMPLATE, commonLines: [...TEMPLATE.commonLines, { materialId: 'pkg:p-duck', qtyPerSet: 1 }] }
    const r = resolveBom(t, PROFILE, 10)
    expect(r.ok).toBe(true)
    const pkg = r.lines.filter((l) => l.materialId === 'pkg:p-duck')
    expect(pkg).toHaveLength(1)
    expect(pkg[0].qty).toBe(20) // 共用 10 + 专属 10
  })

  it('fail-closed：套数非正整数 / 模板坏行 / 带结非 L 档 / 差异位缺色 一律拒', () => {
    expect(resolveBom(TEMPLATE, PROFILE, 0).error).toBe('BAD_SETS')
    expect(resolveBom(TEMPLATE, PROFILE, 1.5).error).toBe('BAD_SETS')
    expect(resolveBom({ ...TEMPLATE, commonLines: [{ materialId: 'hook', qtyPerSet: 0.5 }] }, PROFILE, 1).error).toBe('BAD_TEMPLATE')
    expect(resolveBom({ ...TEMPLATE, yarnSlots: [{ tier: 'M', form: 'knotted', qtyPerSet: 1 }] }, PROFILE, 1).error).toBe('BAD_TEMPLATE') // 带结仅最大团
    expect(resolveBom(TEMPLATE, { ...PROFILE, yarnColors: { L: 'yellow', M: '', S: 'orange' } }, 1).error).toBe('BAD_PROFILE')
    expect(resolveBom(TEMPLATE, { ...PROFILE, cardMaterialId: '' }, 1).error).toBe('BAD_PROFILE')
  })

  it('yarnMaterialId 命名契约（与 collections.ts 头注/建档推导同源）', () => {
    expect(yarnMaterialId('red', 'L', 'knotted')).toBe('yarn:red:L:knotted')
  })
})

// 变异测试幸存者补杀（第二轮）——scmBom 配方解析纯函数（门3·组装/备货共用语义）。
// 期望值全部由源码头注与既有 cloud 测试（app-scm.test.ts saveBomTemplate 口径）推导，不发明。
// 覆盖面：cleanBomTemplate 清洗闸各拒收分支 + 80 截断；resolveBom 三类 fail-closed 错误
// （BAD_SETS/BAD_TEMPLATE/BAD_PROFILE）逐字段钉死 + 主路径用料清单逐行逐量 + 同料号合并累加。
import { describe, it, expect } from 'vitest'
import { cleanBomTemplate, resolveBom, type BomTemplate, type BomProfile } from '../src/scmBom'

/** 合法模板（三档齐全：L 带结 / M·S 原团——业务拍板：带结仅最大团）。 */
const validTemplate = (): BomTemplate => ({
  commonLines: [
    { materialId: 'stuffing', qtyPerSet: 2 },
    { materialId: 'hook', qtyPerSet: 1 },
  ],
  yarnSlots: [
    { tier: 'L', form: 'knotted', qtyPerSet: 2 },
    { tier: 'M', form: 'raw', qtyPerSet: 1 },
    { tier: 'S', form: 'raw', qtyPerSet: 1 },
  ],
})

/** 合法差异位（三档颜色互不相同——钉死 colorOf 档位不串色）。 */
const validProfile = (): BomProfile => ({
  yarnColors: { L: 'pink', M: 'blue', S: 'green' },
  packagingMaterialId: 'pack:p1',
  cardMaterialId: 'card:p1',
})

describe('cleanBomTemplate 清洗闸（落库前白名单·非法即 null 不静默修）', () => {
  it('大白话：合法模板原样收窄通过——输出逐字段等于输入，杂质字段被剥掉、不多一行不少一行', () => {
    const dirty: any = {
      commonLines: [
        { materialId: 'stuffing', qtyPerSet: 2, junk: 'x' },
        { materialId: 'hook', qtyPerSet: 1 },
      ],
      yarnSlots: [
        { tier: 'L', form: 'knotted', qtyPerSet: 2, junk: 'y' },
        { tier: 'M', form: 'raw', qtyPerSet: 1 },
        { tier: 'S', form: 'raw', qtyPerSet: 1 },
      ],
      extra: 'z',
    }
    expect(cleanBomTemplate(dirty)).toEqual(validTemplate())
  })

  it('大白话：整体形状坏就拒——null/undefined、commonLines 或 yarnSlots 不是数组、毛线槽空数组，一律 null', () => {
    expect(cleanBomTemplate(null)).toBe(null)
    expect(cleanBomTemplate(undefined)).toBe(null)
    expect(cleanBomTemplate({ commonLines: {}, yarnSlots: validTemplate().yarnSlots })).toBe(null)
    expect(cleanBomTemplate({ commonLines: validTemplate().commonLines, yarnSlots: {} })).toBe(null)
    expect(cleanBomTemplate({ commonLines: [], yarnSlots: [] })).toBe(null)
  })

  it('大白话：共用料行脏就拒——空行、料号非字符串、料号空串，一律 null', () => {
    const withCommon = (l: any) => ({ commonLines: [l], yarnSlots: validTemplate().yarnSlots })
    expect(cleanBomTemplate(withCommon(null))).toBe(null)
    expect(cleanBomTemplate(withCommon({ materialId: 123, qtyPerSet: 1 }))).toBe(null)
    expect(cleanBomTemplate(withCommon({ materialId: '', qtyPerSet: 1 }))).toBe(null)
  })

  it('大白话：用量必须正整数——0、负数、小数都拒（0/负数放进去备料就算错账）', () => {
    const withCommonQty = (q: any) => ({
      commonLines: [{ materialId: 'stuffing', qtyPerSet: q }],
      yarnSlots: validTemplate().yarnSlots,
    })
    expect(cleanBomTemplate(withCommonQty(0))).toBe(null)
    expect(cleanBomTemplate(withCommonQty(-1))).toBe(null)
    expect(cleanBomTemplate(withCommonQty(1.5))).toBe(null)
    const withSlot = (s: any) => ({ commonLines: [], yarnSlots: [s] })
    expect(cleanBomTemplate(withSlot(null))).toBe(null)
    expect(cleanBomTemplate(withSlot({ tier: 'L', form: 'raw', qtyPerSet: 0 }))).toBe(null)
    expect(cleanBomTemplate(withSlot({ tier: 'L', form: 'raw', qtyPerSet: -1 }))).toBe(null)
    expect(cleanBomTemplate(withSlot({ tier: 'L', form: 'raw', qtyPerSet: 1.5 }))).toBe(null)
  })

  it('大白话：毛线槽白名单——档位只有 L/M/S、形态只有 raw/knotted、带结只许最大团，越线即 null', () => {
    const withSlot = (s: any) => ({ commonLines: [], yarnSlots: [s] })
    expect(cleanBomTemplate(withSlot({ tier: 'X', form: 'raw', qtyPerSet: 1 }))).toBe(null)
    expect(cleanBomTemplate(withSlot({ tier: 'L', form: 'weird', qtyPerSet: 1 }))).toBe(null)
    expect(cleanBomTemplate(withSlot({ tier: 'M', form: 'knotted', qtyPerSet: 1 }))).toBe(null) // 带结仅最大团（用户拍板）
  })

  it('大白话：料号落库前截断 80 字符（存储安全），超长部分不入库', () => {
    const long = 'a'.repeat(100)
    const cleaned = cleanBomTemplate({
      commonLines: [{ materialId: long, qtyPerSet: 1 }],
      yarnSlots: [{ tier: 'L', form: 'raw', qtyPerSet: 1 }],
    })
    expect(cleaned?.commonLines).toEqual([{ materialId: 'a'.repeat(80), qtyPerSet: 1 }])
  })
})

describe('resolveBom 用料解析（模板×差异位×套数·fail-closed 不补默认）', () => {
  it('大白话：套数必须正整数——0、负数、小数一律 BAD_SETS，错误对象逐字段钉死', () => {
    for (const sets of [0, -2, 1.5]) {
      expect(resolveBom(validTemplate(), validProfile(), sets)).toEqual({ ok: false, error: 'BAD_SETS' })
    }
  })

  it('大白话：模板坏 → BAD_TEMPLATE——null/非数组/空槽/脏共用料行/脏毛线槽逐个钉', () => {
    const bad = (t: any) => expect(resolveBom(t, validProfile(), 1)).toEqual({ ok: false, error: 'BAD_TEMPLATE' })
    bad(null)
    bad({ commonLines: {}, yarnSlots: validTemplate().yarnSlots }) // commonLines 非数组
    bad({ commonLines: validTemplate().commonLines, yarnSlots: 'nope' }) // yarnSlots 非数组
    bad({ commonLines: [], yarnSlots: [] }) // 毛线槽空
    const withCommon = (l: any) => ({ commonLines: [l], yarnSlots: validTemplate().yarnSlots })
    bad(withCommon(null))
    bad(withCommon({ materialId: '', qtyPerSet: 1 })) // 料号空
    bad(withCommon({ materialId: 'stuffing', qtyPerSet: 0 }))
    bad(withCommon({ materialId: 'stuffing', qtyPerSet: -1 }))
    bad(withCommon({ materialId: 'stuffing', qtyPerSet: 1.5 }))
    const withSlot = (s: any) => ({ commonLines: [], yarnSlots: [s] })
    bad(withSlot(null))
    bad(withSlot({ tier: 'L', form: 'raw', qtyPerSet: 0 }))
    bad(withSlot({ tier: 'L', form: 'raw', qtyPerSet: 1.5 }))
    bad(withSlot({ tier: 'X', form: 'raw', qtyPerSet: 1 })) // 档位越白名单
    bad(withSlot({ tier: 'L', form: 'weird', qtyPerSet: 1 })) // 形态越白名单
    bad(withSlot({ tier: 'M', form: 'knotted', qtyPerSet: 1 })) // 带结仅最大团（用户拍板）
  })

  it('大白话：差异位坏 → BAD_PROFILE——null/缺颜色表/缺包装/缺卡片/模板要的档位颜色没填', () => {
    const bad = (p: any) => expect(resolveBom(validTemplate(), p, 1)).toEqual({ ok: false, error: 'BAD_PROFILE' })
    bad(null)
    bad({ packagingMaterialId: 'x', cardMaterialId: 'x' }) // 缺 yarnColors
    bad({ yarnColors: { L: 'pink', M: 'blue', S: 'green' }, packagingMaterialId: '', cardMaterialId: 'x' })
    bad({ yarnColors: { L: 'pink', M: 'blue', S: 'green' }, packagingMaterialId: 'x', cardMaterialId: '' })
    // 模板要 S 档，颜色表 S 空 → 拒（模板要的档位颜色必须填）
    bad({ yarnColors: { L: 'pink', M: 'blue', S: '' }, packagingMaterialId: 'x', cardMaterialId: 'x' })
  })

  it('大白话：主路径——模板×差异位×3 套，用料清单逐行逐量钉死，三档颜色各归各档不串色', () => {
    expect(resolveBom(validTemplate(), validProfile(), 3)).toEqual({
      ok: true,
      lines: [
        { materialId: 'stuffing', qty: 6 }, // 2 × 3 套
        { materialId: 'hook', qty: 3 }, // 1 × 3 套
        { materialId: 'yarn:pink:L:knotted', qty: 6 }, // L 档带结·pink
        { materialId: 'yarn:blue:M:raw', qty: 3 }, // M 档原团·blue
        { materialId: 'yarn:green:S:raw', qty: 3 }, // S 档原团·green（串成 M 的 blue 即错）
        { materialId: 'pack:p1', qty: 3 }, // 专属包装 每套 ×1
        { materialId: 'card:p1', qty: 3 }, // 专属卡片 每套 ×1
      ],
    })
  })

  it('大白话：同料号合并累加——共用料撞上包装料号时数量相加、不覆盖不丢', () => {
    const template: BomTemplate = {
      commonLines: [{ materialId: 'box', qtyPerSet: 1 }],
      yarnSlots: [{ tier: 'L', form: 'raw', qtyPerSet: 1 }],
    }
    const profile: BomProfile = {
      yarnColors: { L: 'pink', M: 'blue', S: 'green' },
      packagingMaterialId: 'box', // 与共用料同料号 → 合并：1×2套 + 2套 = 4
      cardMaterialId: 'card:x',
    }
    expect(resolveBom(template, profile, 2)).toEqual({
      ok: true,
      lines: [
        { materialId: 'box', qty: 4 },
        { materialId: 'yarn:pink:L:raw', qty: 2 },
        { materialId: 'card:x', qty: 2 },
      ],
    })
  })
})

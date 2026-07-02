import { describe, it, expect, beforeEach } from 'vitest'
import { createHash } from 'node:crypto'
import { control } from 'wx-server-sdk'
import { main } from '../../packages/cloud/src/functions/admin/adminApi'
import { getDb } from '../../packages/cloud/src/kit'
import * as bom from '../../packages/cloud/src/functions/admin/adminApi/actions/scmBom'
import * as planner from '../../packages/cloud/src/functions/admin/adminApi/actions/scmPlanner'

// SCM-D 备货计算器行为锁（只读·门3 共用解析）：目标套数 × resolveBom → 对比库存 →
// ① 外协缺口（带结不外购：缺口=应送同色 L 原团数·派生原团需求叠进采购口径）
// ② 采购缺口按供应商分列（够扣的不出行·未建档料点名）③ fail-closed（无模板/无差异位/坏 targets）④ RBAC 默认拒。

const sha = (s) => createHash('sha256').update(String(s)).digest('hex')
const SUPER = 'super-admin-key-123'
const OUT = 'outsourced-key-123'
const dctx = (data = {}) => ({ db: getDb(), cloud: null, data, drafts: {}, agentId: 'admin' })
const body = (r) => ({ status: r.statusCode, ...JSON.parse(r.body) })
const call = (action, key, data = {}) =>
  main({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ action, key, data }) }).then(body)

const TEMPLATE = {
  commonLines: [
    { materialId: 'hook', qtyPerSet: 1 },
    { materialId: 'stuffing', qtyPerSet: 40 },
  ],
  yarnSlots: [
    { tier: 'L', form: 'knotted', qtyPerSet: 1 },
    { tier: 'M', form: 'raw', qtyPerSet: 2 },
  ],
}

beforeEach(async () => {
  control.reset()
  control.seed('adminConfig', [
    { _id: 'auth', keyHash: sha(SUPER), role: 'superadmin', caps: ['*'] },
    { _id: 'agent:out1', keyHash: sha(OUT), role: 'outsourced' },
  ])
  control.seed('suppliers', [
    { _id: 's-yarn', name: '毛线厂', type: 'factory' },
    { _id: 's-stuff', name: '填充棉厂', type: 'factory' },
    { _id: 's-pack', name: '包装厂', type: 'factory' },
  ])
  control.seed('materials', [
    { _id: 'hook', name: '钩针', uom: 'count', stock: 100, supplierId: 's-yarn' },
    { _id: 'stuffing', name: '填充棉', uom: 'gram', stock: 1000, supplierId: 's-stuff' },
    { _id: 'yarn:yellow:L:knotted', name: '黄大团带结', uom: 'count', stock: 20, supplierId: 's-yarn' },
    { _id: 'yarn:yellow:L:raw', name: '黄大团原团', uom: 'count', stock: 10, supplierId: 's-yarn' },
    { _id: 'yarn:blue:L:knotted', name: '蓝大团带结', uom: 'count', stock: 30, supplierId: 's-yarn' },
    { _id: 'yarn:white:M:raw', name: '白中团', uom: 'count', stock: 100, supplierId: 's-yarn' },
    { _id: 'pkg:p-duck', name: '鸭包装', uom: 'count', stock: 0, supplierId: 's-pack' },
    { _id: 'card:p-duck', name: '鸭卡片', uom: 'count', stock: 60, supplierId: 's-pack' },
    { _id: 'card:p-cat', name: '猫卡片', uom: 'count', stock: 30, supplierId: 's-pack' },
    // pkg:p-cat 故意不建档（未建档点名 + 进「未挂供应商」组）
  ])
  await bom.saveBomTemplate(dctx({ template: TEMPLATE }))
  await bom.saveBomProfile(dctx({ profile: { productId: 'p-duck', yarnColors: { L: 'yellow', M: 'white', S: 'orange' }, packagingMaterialId: 'pkg:p-duck', cardMaterialId: 'card:p-duck' } }))
  await bom.saveBomProfile(dctx({ profile: { productId: 'p-cat', yarnColors: { L: 'blue', M: 'white', S: 'pink' }, packagingMaterialId: 'pkg:p-cat', cardMaterialId: 'card:p-cat' } }))
})

describe('getRestockPlan（备货计算器·只读）', () => {
  it('外协缺口：带结不外购——缺口=应送同色 L 原团·派生原团需求叠进采购口径', async () => {
    // duck 50 + cat 30：黄带结需 50 库 20 → 外协缺 30；蓝带结需 30 库 30 → 够不出行
    const r = body(await planner.getRestockPlan(dctx({ targets: [{ productId: 'p-duck', sets: 50 }, { productId: 'p-cat', sets: 30 }] })))
    expect(r.status).toBe(200)
    expect(r.outworkGaps).toHaveLength(1)
    expect(r.outworkGaps[0]).toMatchObject({ color: 'yellow', knottedNeed: 50, knottedStock: 20, gap: 30, rawToIssue: 30 })
    // 派生：黄 L 原团需 30（发料用）库 10 → 采购缺 20，挂毛线厂
    const yarnGroup = r.purchaseGroups.find((g) => g.supplierId === 's-yarn')
    const rawLine = yarnGroup.lines.find((l) => l.materialId === 'yarn:yellow:L:raw')
    expect(rawLine).toMatchObject({ need: 30, stock: 10, gap: 20 })
    // 带结料号绝不出现在采购缺口（外协产出·不外购）
    for (const g of r.purchaseGroups) for (const l of g.lines) expect(l.materialId).not.toMatch(/:knotted$/)
  })

  it('采购缺口按供应商分列：够扣不出行·数量=Σ目标·未建档点名进未挂组', async () => {
    const r = body(await planner.getRestockPlan(dctx({ targets: [{ productId: 'p-duck', sets: 50 }, { productId: 'p-cat', sets: 30 }] })))
    // 白中团：需 2×50+2×30=160 库 100 → 缺 60（毛线厂）
    const yarnGroup = r.purchaseGroups.find((g) => g.supplierId === 's-yarn')
    expect(yarnGroup.supplierName).toBe('毛线厂')
    expect(yarnGroup.lines.find((l) => l.materialId === 'yarn:white:M:raw').gap).toBe(60)
    // 钩针：需 80 库 100 → 够·不出行
    expect(yarnGroup.lines.find((l) => l.materialId === 'hook')).toBeUndefined()
    // 填充棉：需 3200 库 1000 → 缺 2200（克）
    expect(r.purchaseGroups.find((g) => g.supplierId === 's-stuff').lines[0]).toMatchObject({ materialId: 'stuffing', gap: 2200, uom: 'gram' })
    // 鸭包装缺 50（包装厂）·鸭/猫卡片够不出行
    const packGroup = r.purchaseGroups.find((g) => g.supplierId === 's-pack')
    expect(packGroup.lines.map((l) => l.materialId)).toEqual(['pkg:p-duck'])
    // 猫包装未建档：点名 + 进「未挂供应商」组按需全采
    expect(r.missingMaterials).toContain('pkg:p-cat')
    expect(r.purchaseGroups.find((g) => g.supplierId === '').lines.find((l) => l.materialId === 'pkg:p-cat').gap).toBe(30)
  })

  it('全够 → 三空（不造缺口）', async () => {
    const r = body(await planner.getRestockPlan(dctx({ targets: [{ productId: 'p-cat', sets: 10 }] })))
    // cat 10 套：带结蓝 10/30 够·白中 20/100 够·hook 10/100·棉 400/1000·卡片 10/30 够——只缺未建档的猫包装
    expect(r.outworkGaps).toHaveLength(0)
    expect(r.purchaseGroups.flatMap((g) => g.lines).map((l) => l.materialId)).toEqual(['pkg:p-cat'])
  })

  it('fail-closed：坏 targets / 无差异位（带 productId）/ 无模板', async () => {
    expect(body(await planner.getRestockPlan(dctx({ targets: [] }))).error).toBe('BAD_TARGETS')
    expect(body(await planner.getRestockPlan(dctx({ targets: [{ productId: 'p-duck', sets: 0 }] }))).error).toBe('BAD_TARGETS')
    const noProfile = body(await planner.getRestockPlan(dctx({ targets: [{ productId: 'ghost', sets: 1 }] })))
    expect(noProfile.error).toBe('NO_PROFILE')
    expect(noProfile.productId).toBe('ghost')
    control.reset()
    control.seed('adminConfig', [{ _id: 'auth', keyHash: sha(SUPER) }])
    await bom.saveBomProfile(dctx({ profile: { productId: 'p-duck', yarnColors: { L: 'a', M: 'b', S: 'c' }, packagingMaterialId: 'x', cardMaterialId: 'y' } }))
    expect(body(await planner.getRestockPlan(dctx({ targets: [{ productId: 'p-duck', sets: 1 }] }))).error).toBe('NO_TEMPLATE')
  })

  it('RBAC 默认拒：外包 403·超管过', async () => {
    expect((await call('getRestockPlan', OUT)).status).toBe(403)
    expect((await call('getRestockPlan', SUPER, { targets: [{ productId: 'p-duck', sets: 1 }] })).status).toBe(200)
  })
})

// getFgSummary（产销统计·只读）：stockLedger 里 assembly_in/ship 两类 fg 流水按 itemKey 分组求和——
// 这是本仓第一个真按字段分组的聚合（此前 GMV/评分聚合都是 _id:null 单桶），专测「按 itemKey 分桶」不串——
// 内存桩曾把 group({_id:'$field'}) 当单桶处理（根因#8 桩≠真 SDK·同批一并修桩），本用例即该修复的行为证据。
describe('getFgSummary（产销统计·只读）', () => {
  it('按 productId__spec 分桶求和：assembly_in 累计打包、ship 累计发货（delta 负转正）·不同产品互不串账', async () => {
    control.seed('stockLedger', [
      { _id: 'l1', itemKey: 'fg:p-duck__', delta: 50, docType: 'assembly_in' },
      { _id: 'l2', itemKey: 'fg:p-duck__', delta: 30, docType: 'assembly_in' }, // 同产品两次打包·须求和成 80 而非各占一桶
      { _id: 'l3', itemKey: 'fg:p-cat__grey', delta: 20, docType: 'assembly_in' },
      { _id: 'l4', itemKey: 'fg:p-duck__', delta: -12, docType: 'ship' },
      { _id: 'l5', itemKey: 'fg:p-duck__', delta: -3, docType: 'ship' },
      { _id: 'l6', itemKey: 'purchase:po1:hook', delta: 5, docType: 'purchase_in' }, // 非 fg 流水·不应混入
    ])
    const r = body(await planner.getFgSummary(dctx()))
    expect(r.status).toBe(200)
    expect(r.packed).toHaveLength(2) // p-duck + p-cat（grey 规格）两桶，不是塌成一桶
    const duckPacked = r.packed.find((x) => x.productId === 'p-duck')
    expect(duckPacked).toMatchObject({ productId: 'p-duck', spec: '', qty: 80 })
    expect(r.packed.find((x) => x.productId === 'p-cat')).toMatchObject({ productId: 'p-cat', spec: 'grey', qty: 20 })
    expect(r.shipped).toHaveLength(1)
    expect(r.shipped[0]).toMatchObject({ productId: 'p-duck', spec: '', qty: 15 }) // 12+3，负转正
  })

  it('无流水 → 两个空数组（不报错）', async () => {
    const r = body(await planner.getFgSummary(dctx()))
    expect(r.status).toBe(200)
    expect(r.packed).toEqual([])
    expect(r.shipped).toEqual([])
  })

  it('RBAC 默认拒：外包 403·超管过', async () => {
    expect((await call('getFgSummary', OUT)).status).toBe(403)
    expect((await call('getFgSummary', SUPER)).status).toBe(200)
  })
})

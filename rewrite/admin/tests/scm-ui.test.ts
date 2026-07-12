// 进销存映射（守卫 rw-admin-scm-ui-golden）：料号人话/元→分整数闸（超两位小数拒·不静默取整）/
// 状态中文/错误码人话原文兜底/流水类型中文。
import { describe, it, expect } from 'vitest'
import shellRaw from '../src/shell/Shell.vue?raw'
import scmMaterialsSrc from '../src/pages/ScmMaterials.vue?raw'
import scmBomSrc from '../src/pages/ScmBom.vue?raw'
import { materialHuman, materialCategoryLabel, uomLabel, purchaseStatusLabel, outworkStatusLabel, yuanToFen, fenLabel, scmErrorText, docTypeLabel, mapLedger, unprofiledProducts } from '../src/lib/mapScm'
import { SCM_FLOW } from '../src/lib/scmFlow'
import { setPurchaseHandoff, consumePurchaseHandoff, setOutworkHandoff, consumeOutworkHandoff } from '../src/lib/scmHandoff'

describe('料号人话', () => {
  it('大白话：毛线拆 色·档·形态；pkg/card 挂产品；fg 成品；其余辅料；空回空', () => {
    expect(materialHuman('yarn:pink:L:knotted')).toBe('毛线·pink·大团·带结')
    expect(materialHuman('yarn:blue:M:raw')).toBe('毛线·blue·中团·原团')
    expect(materialHuman('pkg:p1')).toBe('包装·p1')
    expect(materialHuman('card:p1')).toBe('卡片·p1')
    expect(materialHuman('fg:p1__red')).toBe('成品·p1 red')
    expect(materialHuman('stuffing')).toBe('辅料·stuffing')
    expect(materialHuman('')).toBe('')
    expect(uomLabel('gram')).toBe('克')
    expect(uomLabel('count')).toBe('件')
    // 物料类别中文（换皮丢了类别列·长表不好扫）：主档 category 字段→人话
    expect(materialCategoryLabel('yarn')).toBe('毛线')
    expect(materialCategoryLabel('packaging')).toBe('外包装')
    expect(materialCategoryLabel('card')).toBe('激活卡片')
    expect(materialCategoryLabel('accessory')).toBe('辅料')
    expect(materialCategoryLabel('weird')).toBe('weird') // 未知原文兜底
  })
})

describe('元→分整数闸（输入侧钱链纪律）', () => {
  it('大白话：19.99→1999；0 合法（义务工）；超两位小数/负数/非数一律拒（不静默取整）', () => {
    expect(yuanToFen('19.99')).toBe(1999)
    expect(yuanToFen(3)).toBe(300)
    expect(yuanToFen(0)).toBe(0)
    expect(yuanToFen('0.001')).toBeNull() // 超两位小数拒
    expect(yuanToFen(-1)).toBeNull()
    expect(yuanToFen('abc')).toBeNull()
    expect(yuanToFen('')).toBeNull() // Number('')=0 但空串应显式填——空串按 0？业务上空=没填→此处 Number('')===0 合法边界：明确拒
    expect(fenLabel(1999)).toBe('¥19.99')
    expect(fenLabel(null)).toBe('')
  })
})

describe('状态与错误人话', () => {
  it('大白话：采购/外协状态中文；错误码给人话；带冒号错误取主码；未知原文兜底', () => {
    expect(purchaseStatusLabel('ordered')).toBe('已下单')
    expect(outworkStatusLabel('delivered')).toBe('已收货')
    expect(outworkStatusLabel('weird')).toBe('weird')
    expect(scmErrorText('KNOT_ONLY_L')).toContain('大团')
    expect(scmErrorText('UOM_LOCKED')).toContain('混账')
    expect(scmErrorText('BAD_STATUS:received')).toContain('不允许') // 冒号取主码
    expect(scmErrorText('X_WEIRD')).toContain('X_WEIRD') // 原文兜底
    expect(docTypeLabel('assembly_out')).toBe('组装扣料')
  })

  it('大白话：流水行归一（料号人话/类型中文/脏行安全）', () => {
    const rows = mapLedger([
      { _id: 'l1', itemKey: 'yarn:pink:L:raw', delta: -4, docType: 'outwork_issue', operator: 'admin', at: 1 },
      null,
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].material).toBe('毛线·pink·大团·原团')
    expect(rows[0].docType).toBe('外协发料')
    expect(mapLedger('garbage')).toEqual([])
  })
})

// 未填差异位总览（换皮丢·ScmBom 只遍历已建 profile·没建过差异位的在售产品完全不出现·组装前会被拒却发现不了）：
// 全产品 − 已建 profile = 待建差异位，接回 listDrafts 全目录才看得见。
describe('未填差异位总览（全产品 − 已建 profile）', () => {
  it('大白话：列出还没建差异位的产品（带名字）；已建的剔除；脏档安全', () => {
    const products = [{ id: 'p1', name: '小熊' }, { id: 'p2', name: '小鸭' }, { _id: 'p3', name: '兔子' }, null]
    const profiles = [{ _id: 'p2' }]
    expect(unprofiledProducts(products, profiles)).toEqual([
      { id: 'p1', name: '小熊' },
      { id: 'p3', name: '兔子' },
    ])
    expect(unprofiledProducts(null, null)).toEqual([])
    expect(unprofiledProducts([{ id: 'p1', name: 'x' }], [{ _id: 'p1' }])).toEqual([]) // 全建过=空
  })
})

// ScmFlowTabs 顶部流程条来源（旧线还原·换皮丢）：SCM_FLOW 顺序单源 path 集合必须 === Shell 侧栏「供应链」组，
// 否则流程条会链到死路由 / 与侧栏漂移。Shell↔router 由 rw-admin-nav-route-synced 兜，故 ===Shell ⇒ ⊆router。
describe('SCM 流程条单源同步（防死链/防漂移）', () => {
  it('大白话：SCM_FLOW 的路由集合与 Shell 侧栏供应链组一字不差', () => {
    const shellScmPaths = new Set((shellRaw.match(/\/scm-[a-z]+/g) || []))
    const flowPaths = new Set(SCM_FLOW.map((s) => s.to))
    expect(flowPaths.size).toBe(5)
    expect([...flowPaths].sort()).toEqual([...shellScmPaths].sort()) // 集合相等（顺序各自可不同·内容不许漂移）
    expect(SCM_FLOW.every((s) => s.label && s.icon)).toBe(true) // 每步有中文标签+图标
  })
})

// 备货→采购/外协去开单中转（旧线 store/scmHandoff 移植·换皮丢·流程割裂手抄）：
// 存一份→目标页读一次即清（consume），返回页不重复预填；两条通道互不串。
// 档位从大团切走后重置残留 'knotted'（D2·bug 清除批D·取真源法：v-model 重置逻辑内联在组件里，无法单元测试
// 行为，钉源码模式防回归——tier 切非 L 后 form 原会残留 'knotted'，select 显示空白且提交被云端 KNOT_ONLY_L 拒绝）。
describe('物料主档 tier 切换清残留 form', () => {
  it('大白话：源码含 watch(matForm.value.tier)，非 L 且当前 form 为 knotted 时重置为 raw', () => {
    expect(scmMaterialsSrc).toMatch(/watch\(\s*\(\)\s*=>\s*matForm\.value\.tier/)
    const idx = scmMaterialsSrc.indexOf('watch(() => matForm.value.tier')
    expect(idx).toBeGreaterThan(-1)
    const body = scmMaterialsSrc.slice(idx, idx + 200)
    expect(body).toContain("t !== 'L'")
    expect(body).toContain("matForm.value.form === 'knotted'")
    expect(body).toContain("matForm.value.form = 'raw'")
  })
})

describe('SCM 去开单 handoff（读一次即清）', () => {
  it('大白话：set 后 consume 拿到；再 consume 得 null（不重复预填）；采购/外协两通道独立', () => {
    setPurchaseHandoff({ supplierId: 'sup1', lines: [{ materialId: 'yarn:pink:L:raw', qty: 3 }] })
    const p1 = consumePurchaseHandoff()
    expect(p1?.supplierId).toBe('sup1')
    expect(p1?.lines[0].qty).toBe(3)
    expect(consumePurchaseHandoff()).toBeNull() // 读一次即清·防返回重填

    setOutworkHandoff({ lines: [{ materialId: 'yarn:blue:L:raw', qty: 5 }] })
    expect(consumePurchaseHandoff()).toBeNull() // 外协通道不污染采购通道
    const o1 = consumeOutworkHandoff()
    expect(o1?.lines[0].qty).toBe(5)
    expect(consumeOutworkHandoff()).toBeNull()
  })
})

// ScmBom.vue reload 分路报错（深审20260712·P2 失败伪装空态·取真源法同 D2）：原先四路并行只校验
// getBomSetup 的 b.ok，listAssemblies 单独失败时 assemblies=[]、「组装记录」卡显「还没有组装记录」
// 假空态——照 Reconciliation.vue reload 分路范式，任一路失败点名报出 + EmptyState 文案分流。
describe('ScmBom.vue reload 分路报错（失败不伪装空态）', () => {
  it('大白话：四路各自判失败点名报，不被 b.ok 一路成功吞掉；组装记录空态文案区分「没记录」vs「加载失败」', () => {
    expect(scmBomSrc).toMatch(/if \(!b\.ok\) bad\.push\('配方模板加载失败：'/)
    expect(scmBomSrc).toMatch(/if \(!m\.ok\) bad\.push\('物料主档加载失败：'/)
    expect(scmBomSrc).toMatch(/if \(!a\.ok\) bad\.push\('组装记录加载失败：'/)
    expect(scmBomSrc).toMatch(/if \(!d\.ok\) bad\.push\('产品目录加载失败：'/)
    expect(scmBomSrc).toMatch(/load\(bad\.length === 0, bad\.join\(/)
    // 旧「只看 b.ok」收尾写法不再存在
    expect(scmBomSrc).not.toMatch(/load\(b\.ok/)
    // 组装记录失败标记：reload 落标 + EmptyState 文案按标记分流
    expect(scmBomSrc).toMatch(/asmFailed\.value = !a\.ok/)
    expect(scmBomSrc).toMatch(/:text="asmFailed \? '组装记录加载失败，请刷新重试' : '还没有组装记录'"/)
  })
})

// ScmMaterials.vue 流水加载失败不伪装空账本（深审20260712·P2）：loadLedger 失败原先 ledger=[] 且
// 不留痕，EmptyState「还没有流水」把查询失败伪装成空账；且不可复用 message——reload 收尾 load(m.ok…)
// 会覆盖它，须独立 ledgerError。
describe('ScmMaterials.vue 流水加载失败独立记账（不伪装空账本）', () => {
  it('大白话：listLedger 挂掉写独立 ledgerError；模板失败提示先于表格/空态（v-if 链头），EmptyState 只在真空账时出现', () => {
    expect(scmMaterialsSrc).toMatch(/const ledgerError = ref\(''\)/)
    expect(scmMaterialsSrc).toMatch(/ledgerError\.value = l\.ok \? '' : '流水加载失败：'/)
    // 模板 v-if 链：失败提示 → 表格 → 空态（EmptyState 在链尾 v-else·失败时不渲染假空态）
    expect(scmMaterialsSrc).toMatch(/<p v-if="ledgerError" class="ledger-err">\{\{ ledgerError \}\}<\/p>\s*<template v-else-if="ledger\.length">/)
    const errIdx = scmMaterialsSrc.indexOf('v-if="ledgerError"')
    const emptyIdx = scmMaterialsSrc.indexOf(':icon="ScrollText"')
    expect(errIdx).toBeGreaterThan(-1)
    expect(emptyIdx).toBeGreaterThan(errIdx) // 流水 EmptyState 落在失败提示同链之后
  })
})

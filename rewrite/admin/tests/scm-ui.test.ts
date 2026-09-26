// @vitest-environment happy-dom
// 进销存映射：料号人话/元→分整数闸（超两位小数拒·不静默取整）/
// 状态中文/错误码人话原文兜底/流水类型中文。
import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { materialHuman, materialCategoryLabel, uomLabel, purchaseStatusLabel, outworkStatusLabel, yuanToFen, fenLabel, scmErrorText, docTypeLabel, mapLedger, unprofiledProducts } from '../src/lib/mapScm'
import { SCM_FLOW } from '../src/lib/scmFlow'
import { setPurchaseHandoff, consumePurchaseHandoff, setOutworkHandoff, consumeOutworkHandoff } from '../src/lib/scmHandoff'

vi.mock('../src/api', () => ({ client: { who: () => '', logout: vi.fn() } }))
import Shell from '../src/shell/Shell.vue'

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
    // D5：fg 组合键定界符防护 + BOM 差异位三码的人话翻译（不再原文兜底）
    expect(scmErrorText('BAD_SPEC')).toContain('下划线')
    expect(scmErrorText('NO_SPECIFIC')).toContain('专属件')
    expect(scmErrorText('BAD_PROFILE')).toContain('BOM')
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

// ScmFlowTabs 顶部流程条来源（旧线还原·换皮丢）：SCM_FLOW 5 步必须都挂在侧栏「进销存」组，否则流程条会链到
// 侧栏找不到的页、两边漂移。侧栏比流程只多一个「总览」着陆页（卡片直达 5 步中的某一步，不是流程步骤本身）。
describe('SCM 流程条单源同步（防死链/防漂移）', () => {
  it('大白话：SCM_FLOW（5 步流程）都在侧栏进销存组；进销存组 = 流程 5 步 + 总览这一个额外着陆页，不多不少', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:p(.*)*', component: { template: '<div/>' } }] })
    await router.push('/scm-materials') // 当前路由所在组自动展开
    await router.isReady()
    const w = mount(Shell, { global: { plugins: [router] } })
    await flushPromises()
    const group = w.findAll('.group').find((g) => g.find('.grp-label').text() === '进销存')!
    const sidebar = group.findAll('a.child').map((a) => String(a.attributes('href')))
    const flowPaths = SCM_FLOW.map((s) => s.to)
    expect(new Set(flowPaths).size).toBe(5)
    expect(flowPaths.filter((p) => !sidebar.includes(p))).toEqual([]) // 流程 5 步全部在侧栏（防漏挂）
    expect(sidebar.filter((p) => !flowPaths.includes(p))).toEqual(['/scm-overview']) // 侧栏只多总览
    expect(SCM_FLOW.every((s) => s.label && s.icon)).toBe(true) // 每步有中文标签+图标
  })
})

// 备货→采购/外协去开单中转（旧线 store/scmHandoff 移植·换皮丢·流程割裂手抄）：
// 存一份→目标页读一次即清（consume），返回页不重复预填；两条通道互不串。
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

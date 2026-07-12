// 进销存映射（守卫 rw-admin-scm-ui-golden）：料号人话/元→分整数闸（超两位小数拒·不静默取整）/
// 状态中文/错误码人话原文兜底/流水类型中文。
import { describe, it, expect } from 'vitest'
import shellRaw from '../src/shell/Shell.vue?raw'
import scmMaterialsSrc from '../src/pages/ScmMaterials.vue?raw'
import scmPurchaseSrc from '../src/pages/ScmPurchase.vue?raw'
import scmOutworkSrc from '../src/pages/ScmOutwork.vue?raw'
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

// ScmFlowTabs 顶部流程条来源（旧线还原·换皮丢）：SCM_FLOW 顺序单源 path 集合必须 === Shell 侧栏「供应链」组
// 的「流程步骤」子集，否则流程条会链到死路由 / 与侧栏漂移。Shell↔router 由 rw-admin-nav-route-synced 兜，
// 故 ⊆Shell ⇒ ⊆router。批 B2 新增 /scm-overview：着陆页在流程之上（卡片直达 5 步中的某一步），
// 不是流程步骤本身——只挂侧栏顶部、不进 ScmFlowTabs 5 步单源（lib/scmFlow.ts 不因此改动）。守卫收紧为
// 「SCM_FLOW ⊆ Shell 供应链组」+「Shell 供应链组 = SCM_FLOW ∪ {总览}」，而非放宽成两边随便漂移。
describe('SCM 流程条单源同步（防死链/防漂移）', () => {
  it('大白话：SCM_FLOW（5 步流程）⊆ Shell 侧栏供应链组；供应链组 = 流程 5 步 + 总览这一个额外着陆页，不多不少', () => {
    const shellScmPaths = new Set((shellRaw.match(/\/scm-[a-z]+/g) || []))
    const flowPaths = new Set(SCM_FLOW.map((s) => s.to))
    expect(flowPaths.size).toBe(5)
    expect([...flowPaths].every((p) => shellScmPaths.has(p))).toBe(true) // 流程 5 步全部在侧栏（防漏挂）
    const extra = [...shellScmPaths].filter((p) => !flowPaths.has(p))
    expect(extra).toEqual(['/scm-overview']) // 侧栏比流程只多这一项——总览着陆页，非流程步骤
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

// SCM 四页翻页收口（B1·根因#7）：ScmMaterials（供应商列表+流水列表两处）/ScmPurchase/ScmOutwork/ScmBom（组装记录）
// 各自接了 cursor 续页——源码扫描钉行为（同上方 tier 切换用例范式）：真实交互逻辑跑在浏览器 DOM 事件里，
// 单测测不到点击，只钉「该有的翻页函数与 hasMore/cursor 绑定确实在源码里」防回归被换皮/重构悄悄丢掉。
describe('SCM 四页「加载更多」翻页收口（B1·照抄 Conversations.vue/Orders.vue cursor 续页模式）', () => {
  it('大白话：ScmMaterials 供应商列表 + 流水列表都有独立的 more 函数、都绑 hasMore 判空游标、都续传 cursor', () => {
    expect(scmMaterialsSrc).toMatch(/async function moreSuppliers\s*\(/)
    expect(scmMaterialsSrc).toMatch(/async function moreLedger\s*\(/)
    expect(scmMaterialsSrc).toMatch(/listSuppliers\(\{\s*cursor:\s*supCursor\.value\s*\}\)/)
    expect(scmMaterialsSrc).toMatch(/listLedger\([^)]*\{\s*cursor:\s*ledgerCursor\.value\s*\}\)/)
    expect(scmMaterialsSrc).toMatch(/v-if="supHasMore"/)
    expect(scmMaterialsSrc).toMatch(/v-if="ledgerHasMore"/)
  })

  it('大白话：ScmPurchase 采购单列表 more() 续传当前状态筛选 + cursor', () => {
    expect(scmPurchaseSrc).toMatch(/async function more\s*\(/)
    expect(scmPurchaseSrc).toMatch(/listPurchases\(filter\.value \|\| undefined, \{ cursor: cursor\.value \}\)/)
    expect(scmPurchaseSrc).toMatch(/v-if="hasMore"/)
  })

  it('大白话：ScmOutwork 外协单列表 more() 续传 cursor', () => {
    expect(scmOutworkSrc).toMatch(/async function more\s*\(/)
    expect(scmOutworkSrc).toMatch(/listOutworks\(undefined, \{ cursor: cursor\.value \}\)/)
    expect(scmOutworkSrc).toMatch(/v-if="hasMore"/)
  })

  it('大白话：ScmBom 组装记录 moreAssemblies() 续传 cursor', () => {
    expect(scmBomSrc).toMatch(/async function moreAssemblies\s*\(/)
    expect(scmBomSrc).toMatch(/listAssemblies\(\{ cursor: asmCursor\.value \}\)/)
    expect(scmBomSrc).toMatch(/v-if="asmHasMore"/)
  })
})

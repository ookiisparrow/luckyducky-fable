// 供应链总览（批 B2）源码断言：缺料行去开单路由分流（同 ScmPlanner 去开单中转手法）+
// 最近流水类型徽章映射四类（入/出/产/销）齐全——源码扫描型（同 rewrite/admin/tests/scm-ui.test.ts
// `?raw` + 正则范式），真实交互（点击/路由跳转）不在单测覆盖面，只钉「该有的分流/映射确实在源码里」防回归。
import { describe, it, expect } from 'vitest'
import scmOverviewSrc from '../src/pages/ScmOverview.vue?raw'

describe('缺料行去开单分流（fixRow：outwork 走同色大团原团 1:1、purchase 走原料号预填）', () => {
  it('大白话：suggest===outwork 时用 KNOTTED_RE 拆色号→拼 raw 料号→setOutworkHandoff→push /scm-outwork；否则 setPurchaseHandoff→push /scm-purchase', () => {
    expect(scmOverviewSrc).toMatch(/function fixRow\(/)
    expect(scmOverviewSrc).toMatch(/row\.suggest === 'outwork'/)
    expect(scmOverviewSrc).toMatch(/KNOTTED_RE\.exec\(String\(row\.materialId\)\)/)
    expect(scmOverviewSrc).toMatch(/setOutworkHandoff\(\{\s*lines:\s*\[\{\s*materialId:\s*rawId,\s*qty:\s*Number\(row\.gap\)\s*\|\|\s*0\s*\}\]\s*\}\)/)
    expect(scmOverviewSrc).toMatch(/router\.push\('\/scm-outwork'\)/)
    expect(scmOverviewSrc).toMatch(/setPurchaseHandoff\(\{\s*supplierId:\s*''/)
    expect(scmOverviewSrc).toMatch(/router\.push\('\/scm-purchase'\)/)
  })
})

describe('最近流水类型徽章映射（入/出/产/销四类齐全·docType→徽章）', () => {
  it('大白话：purchase_in/outwork_receive=入；outwork_issue/assembly_out=出；assembly_in=产；ship=销；未知按 delta 正负兜底', () => {
    const m = scmOverviewSrc.match(/const LEDGER_BADGE[\s\S]*?\n\}/)
    expect(m).toBeTruthy()
    const table = m![0]
    expect(table).toMatch(/purchase_in:\s*\{\s*label:\s*'入'/)
    expect(table).toMatch(/outwork_receive:\s*\{\s*label:\s*'入'/)
    expect(table).toMatch(/outwork_issue:\s*\{\s*label:\s*'出'/)
    expect(table).toMatch(/assembly_out:\s*\{\s*label:\s*'出'/)
    expect(table).toMatch(/assembly_in:\s*\{\s*label:\s*'产'/)
    expect(table).toMatch(/ship:\s*\{\s*label:\s*'销'/)
    expect(scmOverviewSrc).toMatch(/Number\(l\.delta\)\s*>=\s*0\s*\?\s*\{\s*label:\s*'入'/) // adjust 等未登记类型兜底
  })
})

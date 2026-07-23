// 体检面板派生性测试（守卫 check-report-derived·roots 正册）——
// 面板必须是「守卫注册表 + vitest 结果」的机器派生视图：四注册表一条不漏也不多造、
// 失败现场置顶可见、单测带复跑命令、病根地图与根因账本 §一 同源解析。
// 为什么派生而不手抄：手抄清单迟早漂移（病根#11 同款），派生视图漏一条本测试即红。
// 反向自检：让 guardCatalog 漏掉任一注册表 / 渲染器丢失败信息 → 红。
import { describe, it, expect } from 'vitest'
import { repoChecks, fileRules, typeAndTestGuards } from '../../scripts/check-structure.mjs'
import { guardCatalog, parseRootLedger, renderHtml } from '../../scripts/check-report.mjs'

const allIds = [
  ...repoChecks.map((g) => g.id),
  ...fileRules.map((g) => g.id),
  ...typeAndTestGuards.map((g) => g.id),
]

// 面板数据夹具：真实守卫册 + 人造状态（一条守卫红、一条测试红），不跑真守卫（跑真守卫是 npm run report 的事）
const fakeData = () => {
  const guards = guardCatalog().map((g) => ({
    ...g,
    ok: g.id !== 'stub-only-sdk',
    ms: 1,
    violations: g.id === 'stub-only-sdk' ? ['假违例样本X'] : [],
  }))
  return {
    meta: { generatedAt: '2026-07-04 12:00', head: 'abc1234', branch: 'main', durationMs: 1234 },
    guards,
    tests: [
      { file: 'rewrite/shared/tests/money.test.ts', project: 'rw', name: '分闸 > 非整数抛', ok: false, ms: 2, error: 'expected 1 to be 2' },
      { file: 'tests/cloud/orders.test.js', project: 'cloud', name: '创建订单', ok: true, ms: 3 },
    ],
    gates: { typecheck: [{ pkg: 'rewrite/shared', ok: true, out: '' }], lint: { ok: true, errors: 0, warnings: 7 } },
    ledger: parseRootLedger(),
  }
}

describe('体检面板=注册表派生（check-report-derived）', () => {
  it('guardCatalog 覆盖四注册表全部守卫，一条不漏也不多造', () => {
    const ids = guardCatalog().map((g) => g.id)
    const set = new Set(ids)
    for (const id of allIds) expect(set.has(id), `面板漏守卫：${id}`).toBe(true)
    expect(ids.length, '面板守卫数 ≠ 注册表总数（多造或重复 id）').toBe(allIds.length)
  })

  it('病根地图与根因账本 §一 同源：#1..#14 全在且带标题', () => {
    const ledger = parseRootLedger()
    const nums = ledger.map((r) => r.num)
    for (let n = 1; n <= 14; n++) expect(nums, `病根 #${n} 未解析到`).toContain(n)
    expect(ledger.every((r) => r.title.length > 0), '病根标题为空').toBe(true)
  })

  it('渲染完整性：每条守卫 id 在 HTML 里；失败守卫/失败测试现场可见；单测带复跑命令', () => {
    const html = renderHtml(fakeData())
    for (const id of allIds) expect(html, `HTML 缺守卫 ${id}`).toContain(id)
    expect(html, '失败守卫的违例现场丢了').toContain('假违例样本X')
    expect(html, '失败测试的报错原文丢了').toContain('expected 1 to be 2')
    expect(html, '单测缺复跑命令').toContain('npx vitest run rewrite/shared/tests/money.test.ts')
  })

  it('面板带 noindex（会部署到公网静态托管——守卫清单不进搜索引擎）', () => {
    const html = renderHtml(fakeData())
    expect(html).toContain('name="robots" content="noindex')
  })

  it('全绿时红灯区显式报「全绿」，不留空白让人猜', () => {
    const d = fakeData()
    d.guards = d.guards.map((g) => ({ ...g, ok: true, violations: [] }))
    d.tests = d.tests.map((t) => ({ ...t, ok: true, error: undefined }))
    const html = renderHtml(d)
    expect(html).toContain('全绿')
  })
})

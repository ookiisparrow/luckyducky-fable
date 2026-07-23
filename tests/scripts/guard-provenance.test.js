// 守卫 provenance 完整性——每条守卫都必须标明治哪条病根/主张（roots）。
// 这是 guard-coverage 体检闸（B3）的前置：没有 provenance 就无法机器核覆盖率。
// 反向自检：删任一规则的 roots → 本测试红。
import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { repoChecks, fileRules, typeAndTestGuards } from '../../scripts/check-structure.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

describe('守卫 provenance（roots 不缺失）', () => {
  const ruleGuards = [
    ...repoChecks.map((r) => ['repoCheck', r.id, r.roots]),
    ...fileRules.map((r) => ['fileRule', r.id, r.roots]),
  ]

  it.each(ruleGuards)('%s/%s 有非空 roots', (kind, id, roots) => {
    expect(Array.isArray(roots), `${kind} ${id} 缺 roots 数组`).toBe(true)
    expect(roots.length, `${kind} ${id} roots 为空`).toBeGreaterThan(0)
  })

  it('每条规则守卫都有 id（注册表可被 guard-coverage 引用）', () => {
    for (const [kind, id] of ruleGuards) expect(id, `${kind} 缺 id`).toBeTruthy()
  })

  it('typeAndTestGuards：每条有 roots + reverseTest；test 型指向存在的测试文件', () => {
    expect(typeAndTestGuards.length).toBeGreaterThan(0)
    for (const g of typeAndTestGuards) {
      expect(g.roots?.length, `${g.id} 缺 roots`).toBeGreaterThan(0)
      expect(g.reverseTest, `${g.id} 缺 reverseTest`).toBeTruthy()
      expect(['ts', 'test'], `${g.id} mechanism 非法`).toContain(g.mechanism)
      if (g.mechanism === 'test') {
        expect(
          existsSync(resolve(ROOT, g.reverseTest)),
          `${g.id} reverseTest 文件不存在：${g.reverseTest}`
        ).toBe(true)
      }
    }
  })
})

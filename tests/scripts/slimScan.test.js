import { describe, it, expect } from 'vitest'
import {
  parseExports,
  findDeadExports,
  topLevelPkgName,
  findPhantomDeps,
  checkBudget,
} from '../../scripts/lib/slim-scan.mjs'

// 守卫 rw-dead-exports/rw-phantom-deps/rw-loc-budget/rw-lock-budget（病根17「持续义务有传感器」）
// 的核心判定逻辑（tests/scripts/slimScan.test.js·反向自检）。IO 收集层不进本文件断言范围。
describe('slim-scan parseExports：六种导出形态 + 注释行排除', () => {
  it('抓到 const/function/async function/type/interface/class 六种形态', () => {
    const src = `
export const A = 1
export function B() {
  return 1
}
export async function C() {
  return 1
}
export type D = string
export interface E {
  x: number
}
export class F {}
`
    const names = parseExports(src)
    expect(names).toEqual(['A', 'B', 'C', 'D', 'E', 'F'])
  })

  it('注释行里的假导出不算（行首 // 或 * 均排除）', () => {
    const src = `
// export const FAKE1 = 1
/**
 * export const FAKE2 = 1
 */
export const REAL = 1
`
    expect(parseExports(src)).toEqual(['REAL'])
  })
})

describe('slim-scan findDeadExports：死导出判定', () => {
  // 固件：shared 包四个源文件 + index.ts 整包再导出
  const fooTs = {
    path: 'rewrite/shared/src/foo.ts',
    // 符号名故意与文件名同名（foo），用来验证 index.ts 的 `export * from './foo'`
    // 这一行本身文本上含 'foo'、若不排除会被误判为"消费"，从而漏判死代码
    text: `
export function foo() {
  return 1
}
`,
  }
  const barTs = {
    path: 'rewrite/shared/src/bar.ts',
    text: `
export function deadFn() {
  return 42
}

export function aliveInternal() {
  return 2
}
`,
  }
  const bazTs = {
    path: 'rewrite/shared/src/baz.ts',
    text: `
import { aliveInternal } from './bar'

export function useIt() {
  return aliveInternal()
}
`,
  }
  const guardedTs = {
    path: 'rewrite/shared/src/guarded.ts',
    text: `
export const GUARD_TOKEN = 'token-guard'
`,
  }
  const indexTs = {
    path: 'rewrite/shared/src/index.ts',
    text: `
export * from './foo'
export * from './bar'
export * from './baz'
export * from './guarded'
`,
  }
  const files = [fooTs, barTs, bazTs, guardedTs, indexTs]

  const consumerTexts = [
    {
      path: 'rewrite/cloud/src/functions/app/actions/order.ts',
      text: `import { useIt } from '@ldrw/shared'\nuseIt()\n`,
    },
    {
      // 消费面含守卫文本级引用（本仓铁律：check-structure.mjs 这类文本级消费也算消费）
      path: 'scripts/check-structure.mjs',
      text: `// 守卫样文：正则里提到 GUARD_TOKEN 即算消费\nconst rule = /GUARD_TOKEN/\n`,
    },
  ]

  it('真死（零消费）被抓到：deadFn 哪儿都没人用', () => {
    const dead = findDeadExports({ files, consumerTexts })
    expect(dead).toContainEqual({ file: barTs.path, name: 'deadFn' })
  })

  it('index.ts 的 export * from 行不算消费：foo 与文件名撞名也照样判死', () => {
    const dead = findDeadExports({ files, consumerTexts })
    expect(dead).toContainEqual({ file: fooTs.path, name: 'foo' })
  })

  it('被守卫文本消费的不算死：GUARD_TOKEN 只在 check-structure.mjs 样文里出现也算活', () => {
    const dead = findDeadExports({ files, consumerTexts })
    expect(dead.some((d) => d.name === 'GUARD_TOKEN')).toBe(false)
  })

  it('同包内部使用不算死：aliveInternal 只在 baz.ts 里被 import 用到也算活', () => {
    const dead = findDeadExports({ files, consumerTexts })
    expect(dead.some((d) => d.name === 'aliveInternal')).toBe(false)
  })

  it('消费面直接用到的不算死：useIt 在 consumerTexts 里出现', () => {
    const dead = findDeadExports({ files, consumerTexts })
    expect(dead.some((d) => d.name === 'useIt')).toBe(false)
  })

  it('死导出清单只含 foo 与 deadFn 两项（无误伤）', () => {
    const dead = findDeadExports({ files, consumerTexts })
    expect(dead).toHaveLength(2)
  })
})

describe('slim-scan topLevelPkgName：说明符取顶层包名', () => {
  it('内置模块 node:fs → null', () => {
    expect(topLevelPkgName('node:fs')).toBeNull()
  })
  it('同级相对路径 ./x → null', () => {
    expect(topLevelPkgName('./x')).toBeNull()
  })
  it('上级相对路径 ../x → null', () => {
    expect(topLevelPkgName('../x')).toBeNull()
  })
  it('作用域包带子路径 @scope/pkg/sub → @scope/pkg', () => {
    expect(topLevelPkgName('@scope/pkg/sub')).toBe('@scope/pkg')
  })
  it('普通包带子路径 pkg/sub → pkg', () => {
    expect(topLevelPkgName('pkg/sub')).toBe('pkg')
  })
  it('裸包名 lodash → lodash（无子路径也原样返回）', () => {
    expect(topLevelPkgName('lodash')).toBe('lodash')
  })
})

describe('slim-scan findPhantomDeps：幽灵依赖判定', () => {
  it('未声明的包被抓到', () => {
    const sourceImports = [{ path: 'rewrite/cloud/src/foo.ts', specifiers: ['left-pad'] }]
    const declared = new Set(['esbuild'])
    const phantom = findPhantomDeps({ sourceImports, declared })
    expect(phantom).toEqual(['left-pad（首见于 rewrite/cloud/src/foo.ts）'])
  })

  it('@ldrw/shared 豁免（workspace 内别名，不算幽灵）', () => {
    const sourceImports = [{ path: 'rewrite/cloud/src/foo.ts', specifiers: ['@ldrw/shared'] }]
    const declared = new Set()
    expect(findPhantomDeps({ sourceImports, declared })).toEqual([])
  })

  it('node:/相对路径不算幽灵依赖', () => {
    const sourceImports = [
      { path: 'rewrite/cloud/src/foo.ts', specifiers: ['node:fs', './bar', '../baz'] },
    ]
    const declared = new Set()
    expect(findPhantomDeps({ sourceImports, declared })).toEqual([])
  })

  it('已声明的包不算幽灵、重复首见只留第一条', () => {
    const sourceImports = [
      { path: 'a.ts', specifiers: ['esbuild', 'left-pad'] },
      { path: 'b.ts', specifiers: ['left-pad'] },
    ]
    const declared = new Set(['esbuild'])
    expect(findPhantomDeps({ sourceImports, declared })).toEqual(['left-pad（首见于 a.ts）'])
  })
})

describe('slim-scan checkBudget：规模棘轮三态', () => {
  it('膨胀超预算 → 红（current 超 baseline*growCap）', () => {
    const v = checkBudget({ label: 'shared LOC', current: 1200, baseline: 1000 })
    expect(v).toHaveLength(1)
    expect(v[0]).toContain('膨胀')
    expect(v[0]).toContain('1000')
    expect(v[0]).toContain('1200')
  })

  it('基线虚高 → 红（baseline 超 current*slackCap，瘦身成果没锁住）', () => {
    const v = checkBudget({ label: 'shared LOC', current: 800, baseline: 1000 })
    expect(v).toHaveLength(1)
    expect(v[0]).toContain('基线虚高')
  })

  it('带宽内 → 绿（current 与 baseline 相近，两头都不触发）', () => {
    expect(checkBudget({ label: 'shared LOC', current: 1020, baseline: 1000 })).toEqual([])
  })
})

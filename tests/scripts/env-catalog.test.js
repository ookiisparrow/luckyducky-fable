import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import {
  ENV_CATALOG,
  ENV_SELECTORS,
  PROD_ENV,
  TEST_ENV,
  assertMay,
  listTargets,
  parseTargetFromArgv,
  resolveTarget,
  resolveWriteTestTarget,
} from '../../scripts/lib/env.mjs'

const ROOT = resolve(import.meta.dirname, '../..')
const SECRETISH = /secret|password|token|private[_-]?key|credential/i

describe('ENV_CATALOG：三选择子入册、无密钥', () => {
  it('选择子恰好 stub / test / prod-readonly', () => {
    expect([...ENV_SELECTORS]).toEqual(['stub', 'test', 'prod-readonly'])
    expect(Object.keys(ENV_CATALOG)).toEqual(['stub', 'test', 'prod-readonly'])
  })

  it('git 分支对照 + 门牌（公开 env id，不是密钥）', () => {
    expect(ENV_CATALOG.stub.envId).toBeNull()
    expect(ENV_CATALOG.stub.gitBranch).toBeNull()
    expect(ENV_CATALOG.stub.writes).toBe(false)
    expect(ENV_CATALOG.stub.cloud).toBe(false)

    expect(ENV_CATALOG.test.envId).toBe(TEST_ENV)
    expect(ENV_CATALOG.test.gitBranch).toBe('test')
    expect(ENV_CATALOG.test.writes).toBe(true)
    expect(TEST_ENV).toBe('yaliceshi-d3get0o7ja6c91f8f')

    expect(ENV_CATALOG['prod-readonly'].envId).toBe(PROD_ENV)
    expect(ENV_CATALOG['prod-readonly'].gitBranch).toBe('main')
    expect(ENV_CATALOG['prod-readonly'].writes).toBe(false)
    expect(PROD_ENV).toBe('cloudbase-d4gcssqbv06865479')
  })

  it('目录 JSON 不含密钥字段', () => {
    const blob = JSON.stringify(ENV_CATALOG)
    expect(blob).not.toMatch(SECRETISH)
    for (const t of listTargets()) {
      expect(Object.keys(t).join(',')).not.toMatch(SECRETISH)
    }
  })
})

describe('resolveTarget：同一套断言对 {桩|测试云|生产只读}', () => {
  it('stub → 无 envId、不连云、不可写', () => {
    const t = resolveTarget('stub')
    expect(t.selector).toBe('stub')
    expect(t.envId).toBeNull()
    expect(t.cloud).toBe(false)
    expect(t.writes).toBe(false)
    expect(() => assertMay(t, 'assert')).not.toThrow()
    expect(() => assertMay(t, 'loadtest')).toThrow(/不允许 loadtest/)
  })

  it('test → 测试云门牌、可写', () => {
    const t = resolveTarget('test')
    expect(t.selector).toBe('test')
    expect(t.envId).toBe(TEST_ENV)
    expect(t.writes).toBe(true)
    expect(() => assertMay(t, 'loadtest')).not.toThrow()
    expect(() => assertMay(t, 'deploy-test')).not.toThrow()
  })

  it('prod-readonly → 生产门牌、只读', () => {
    const t = resolveTarget('prod-readonly')
    expect(t.selector).toBe('prod-readonly')
    expect(t.envId).toBe(PROD_ENV)
    expect(t.writes).toBe(false)
    expect(() => assertMay(t, 'assert')).not.toThrow()
    expect(() => assertMay(t, 'loadtest')).toThrow(/不允许 loadtest/)
  })

  it('空输入 / prod / 生产 envId → 生产只读保险（永不给生产写入）', () => {
    expect(resolveTarget().selector).toBe('prod-readonly')
    expect(resolveTarget('').selector).toBe('prod-readonly')
    expect(resolveTarget('prod').selector).toBe('prod-readonly')
    expect(resolveTarget('production').selector).toBe('prod-readonly')
    expect(resolveTarget(PROD_ENV).selector).toBe('prod-readonly')
    expect(resolveTarget(PROD_ENV).writes).toBe(false)
  })

  it('测试 envId → test', () => {
    expect(resolveTarget(TEST_ENV).selector).toBe('test')
  })

  it('未知选择子 → 抛', () => {
    expect(() => resolveTarget('some-other-env')).toThrow(/未知环境选择/)
    expect(() => resolveTarget('prod-write')).toThrow(/未知环境选择/)
  })
})

describe('resolveWriteTestTarget：写测试必须显式 test', () => {
  it('空输入拒绝（测试云不从缺省滑进去）', () => {
    expect(() => resolveWriteTestTarget()).toThrow(/须显式/)
    expect(() => resolveWriteTestTarget('')).toThrow(/须显式/)
  })

  it('--target test / 测试 envId 通过', () => {
    expect(resolveWriteTestTarget('test').envId).toBe(TEST_ENV)
    expect(resolveWriteTestTarget(TEST_ENV).envId).toBe(TEST_ENV)
  })

  it('生产只读 / 桩 / prod 别名一律拒', () => {
    expect(() => resolveWriteTestTarget('prod-readonly')).toThrow(/不可写/)
    expect(() => resolveWriteTestTarget('prod')).toThrow(/不可写/)
    expect(() => resolveWriteTestTarget(PROD_ENV)).toThrow(/不可写/)
    expect(() => resolveWriteTestTarget('stub')).toThrow(/不可写/)
  })
})

describe('parseTargetFromArgv', () => {
  it('--target 优先于 --env 与环境变量', () => {
    expect(parseTargetFromArgv(['node', 'x', '--target', 'test', '--env', 'ignored'], { LD_TARGET: 'stub' })).toBe(
      'test',
    )
    expect(parseTargetFromArgv(['node', 'x', '--env', TEST_ENV], {})).toBe(TEST_ENV)
    expect(parseTargetFromArgv(['node', 'x'], { LD_TARGET: 'prod-readonly' })).toBe('prod-readonly')
    expect(parseTargetFromArgv(['node', 'x'], {})).toBe('')
  })
})

describe('env-resolve dry-run：无密钥、三选择子解析对', () => {
  const bin = resolve(ROOT, 'scripts/env-resolve.mjs')

  it('无参列出三行，不含密钥字段', () => {
    const out = execFileSync(process.execPath, [bin], { encoding: 'utf8', env: { ...process.env, LD_TARGET: '', TEST_ENV: '', LD_TEST_ENV: '' } })
    expect(out).toContain('"selector": "stub"')
    expect(out).toContain('"selector": "test"')
    expect(out).toContain('"selector": "prod-readonly"')
    expect(out).not.toMatch(SECRETISH)
  })

  it('--target stub|test|prod-readonly 各解析对', () => {
    for (const sel of ['stub', 'test', 'prod-readonly']) {
      const out = execFileSync(process.execPath, [bin, '--target', sel], { encoding: 'utf8' })
      const j = JSON.parse(out)
      expect(j.selector).toBe(sel)
      expect(j.envId).toBe(ENV_CATALOG[sel].envId)
      expect(out).not.toMatch(SECRETISH)
    }
  })

  it('未知 --target 非零退出', () => {
    expect(() => execFileSync(process.execPath, [bin, '--target', 'no-such'], { encoding: 'utf8' })).toThrow()
  })
})

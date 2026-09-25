import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  DEFAULT_ENDS,
  resolveEnds,
  worktreeDirty,
  gitFollowPlan,
  rewriteBuildChannel,
  channelPinLabel,
  formatSummary,
} from '../../scripts/mac-sync-ends.mjs'

const ROOT = resolve(import.meta.dirname, '../..')
const src = readFileSync(resolve(ROOT, 'scripts/mac-sync-ends.mjs'), 'utf8')
const SAMPLE = "export const BUILD_CHANNEL: '' | 'develop' | 'trial' | 'release' | 'experimental' = ''\n"

describe('resolveEnds：默认 Mac 三路径，env/args 可改', () => {
  it('无覆盖 → 赵老板三台固定目录', () => {
    const ends = resolveEnds(['node', 'scripts/mac-sync-ends.mjs'], {})
    expect(ends.map((e) => e.path)).toEqual([
      '/Users/sparrow/luckyducky-fable',
      '/Users/sparrow/luckyducky-test',
      '/Users/sparrow/luckyducky-release',
    ])
    expect(ends.map((e) => e.follow)).toEqual(['main', 'test', 'release'])
  })

  it('argv 压过 env，env 压过默认', () => {
    const env = { MAC_SYNC_FABLE: '/env/fable', MAC_SYNC_TEST: '/env/test' }
    const ends = resolveEnds(['node', 'x', '--fable', '/arg/fable', '--release=/arg/rel'], env)
    expect(ends.find((e) => e.id === 'fable').path).toBe('/arg/fable')
    expect(ends.find((e) => e.id === 'test').path).toBe('/env/test')
    expect(ends.find((e) => e.id === 'release').path).toBe('/arg/rel')
  })
})

describe('gitFollowPlan：只快进 / detach，不硬撤', () => {
  it('开发跟 main，测试跟 test，发布候选挂 origin/main', () => {
    expect(gitFollowPlan('main')).toEqual([
      ['checkout', 'main'],
      ['pull', '--ff-only', 'origin', 'main'],
    ])
    expect(gitFollowPlan('test')).toEqual([
      ['checkout', 'test'],
      ['pull', '--ff-only', 'origin', 'test'],
    ])
    expect(gitFollowPlan('release')).toEqual([['checkout', '--detach', 'origin/main']])
  })

  it('计划里不能出现强推硬撤', () => {
    for (const kind of ['main', 'test', 'release']) {
      const tokens = gitFollowPlan(kind).flat()
      expect(tokens).not.toContain('reset')
      expect(tokens).not.toContain('--force')
      expect(tokens).not.toContain('-f')
      expect(tokens).not.toContain('push')
    }
  })
})

describe('rewriteBuildChannel：只改赋值', () => {
  it('空通道钉成 release，类型字面量不动', () => {
    const next = rewriteBuildChannel(SAMPLE, 'release')
    expect(next).toBe("export const BUILD_CHANNEL: '' | 'develop' | 'trial' | 'release' | 'experimental' = 'release'\n")
  })

  it('测试线 trial → release；已经是 release 再钉一次不变形', () => {
    const trial = SAMPLE.replace("= ''", "= 'trial'")
    expect(rewriteBuildChannel(trial, 'release')).toContain("= 'release'")
    const pinned = rewriteBuildChannel(SAMPLE, 'release')
    expect(rewriteBuildChannel(pinned, 'release')).toBe(pinned)
  })

  it('没有赋值行就停', () => {
    expect(() => rewriteBuildChannel('const x = 1\n', 'release')).toThrow(/BUILD_CHANNEL/)
  })
})

describe('摘要与脏检测', () => {
  it('porcelain 有字才算脏；忽略空行', () => {
    expect(worktreeDirty('')).toBe(false)
    expect(worktreeDirty('  \n')).toBe(false)
    expect(worktreeDirty(' M rewrite/mp/lib/appVersion.ts\n')).toBe(true)
    expect(worktreeDirty('?? scratch.txt\n')).toBe(true)
  })

  it('通道展示：主线运行时，发布候选标本地钉', () => {
    expect(channelPinLabel('', false)).toBe('运行时')
    expect(channelPinLabel('trial', false)).toBe('trial')
    expect(channelPinLabel('release', true)).toBe('release（本地钉）')
  })

  it('摘要一行一个端，失败写失败', () => {
    const text = formatSummary([
      { label: '开发', sha: 'abc1234', date: '2026-09-04', channel: '', localPin: false },
      { label: '测试', error: 'git pull --ff-only origin test 失败' },
    ])
    expect(text).toContain('开发  abc1234  日期 2026-09-04  通道 运行时')
    expect(text).toContain('测试  失败：git pull --ff-only origin test 失败')
  })
})

describe('脚本本体不带硬撤', () => {
  it('有 stash -u 和 ff-only，没有 reset/--force', () => {
    expect(src).toContain("['stash', 'push', '-u', '-m', msg]")
    expect(src).toContain("'--ff-only'")
    expect(src).not.toMatch(/reset --hard/)
    expect(src).not.toMatch(/push --force/)
    expect(src).not.toMatch(/checkout -f\b/)
    expect(DEFAULT_ENDS.release.path).toContain('luckyducky-release')
  })
})

import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { readFileSync as read } from 'node:fs'
import {
  shanghaiToday,
  resolveStampChannel,
  stampMpVersion,
  stampMpVersionDate,
} from '../../scripts/stamp-mp-version-date.mjs'

const ROOT = resolve(import.meta.dirname, '../..')
const stampSrc = read(resolve(ROOT, 'scripts/stamp-mp-version-date.mjs'), 'utf8')
const hookSrc = read(resolve(ROOT, 'scripts/git-hooks/pre-commit'), 'utf8')
const pkg = JSON.parse(read(resolve(ROOT, 'package.json'), 'utf8'))
const stampWfSrc = read(resolve(ROOT, '.github/workflows/mp-version-stamp.yml'), 'utf8')
const releaseSrc = read(resolve(ROOT, 'scripts/release.mjs'), 'utf8')
const macSrc = read(resolve(ROOT, 'scripts/mac-sync-ends.mjs'), 'utf8')

const SAMPLE = `export const BUILD_CHANNEL: '' | 'develop' | 'trial' | 'release' | 'experimental' = ''
export const DEV_UPDATE_DATE = '2020-01-01'
`

function withAppVersion(src) {
  const dir = mkdtempSync(join(tmpdir(), 'mp-stamp-'))
  mkdirSync(join(dir, 'rewrite/mp/lib'), { recursive: true })
  writeFileSync(join(dir, 'rewrite/mp/lib/appVersion.ts'), src)
  return dir
}

describe('shanghaiToday：上海日历', () => {
  it('大白话：日期按上海时区出 YYYY-MM-DD，不跟机器本地时区跑', () => {
    expect(shanghaiToday(Date.parse('2026-09-18T01:00:00+08:00'))).toBe('2026-09-18')
    expect(shanghaiToday(Date.parse('2026-09-17T23:30:00+08:00'))).toBe('2026-09-17')
    expect(stampSrc).toContain('Asia/Shanghai')
  })
})

describe('resolveStampChannel：分支 → 通道（老板 2026-09-18）', () => {
  it('大白话：本仓 main 钉开发，test 钉测试；环境变量能盖；对不上的枝不动通道', () => {
    expect(resolveStampChannel({ branch: 'main' })).toBe('develop')
    expect(resolveStampChannel({ branch: 'refs/heads/main' })).toBe('develop')
    expect(resolveStampChannel({ branch: 'test' })).toBe('trial')
    expect(resolveStampChannel({ branch: 'cursor/foo-7422', baseBranch: 'test' })).toBe('trial')
    expect(resolveStampChannel({ branch: 'cursor/foo-7422', baseBranch: 'main' })).toBe('develop')
    expect(resolveStampChannel({ envChannel: 'experimental' })).toBe('experimental')
    expect(resolveStampChannel({ envChannel: 'release' })).toBe('release')
    expect(resolveStampChannel({ branch: 'cursor/foo-7422' })).toBe(null)
    expect(resolveStampChannel({})).toBe(null)
  })
})

describe('stampMpVersion：日期 + 通道一起写', () => {
  it('大白话：旧日期改成上海当天；main 枝顺手把通道写成 develop', () => {
    const dir = withAppVersion(SAMPLE)
    try {
      const r = stampMpVersion(dir, { now: Date.parse('2026-09-18T12:00:00+08:00'), branch: 'main' })
      expect(r.date).toBe('2026-09-18')
      expect(r.channel).toBe('develop')
      expect(r.changed).toBe(true)
      const out = readFileSync(join(dir, 'rewrite/mp/lib/appVersion.ts'), 'utf8')
      expect(out).toContain("export const DEV_UPDATE_DATE = '2026-09-18'")
      expect(out).toContain("= 'develop'")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('大白话：test 枝写成 trial；已经是当天再戳一次不算改', () => {
    const dir = withAppVersion(SAMPLE.replace("= ''", "= 'trial'").replace('2020-01-01', '2026-09-18'))
    try {
      const r = stampMpVersion(dir, { now: Date.parse('2026-09-18T12:00:00+08:00'), branch: 'test' })
      expect(r.changed).toBe(false)
      expect(r.channel).toBe('trial')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('大白话：功能枝只改日期、不动通道；--check / dryRun 不写盘', () => {
    const dir = withAppVersion(SAMPLE)
    try {
      const r = stampMpVersion(dir, {
        now: Date.parse('2026-09-18T12:00:00+08:00'),
        branch: 'cursor/foo-7422',
        dryRun: true,
      })
      expect(r.changed).toBe(true)
      expect(r.channel).toBe(null)
      const out = readFileSync(join(dir, 'rewrite/mp/lib/appVersion.ts'), 'utf8')
      expect(out).toContain("DEV_UPDATE_DATE = '2020-01-01'")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('大白话：旧入口 stampMpVersionDate 仍返回日期字符串', () => {
    const dir = withAppVersion(SAMPLE)
    try {
      expect(stampMpVersionDate(dir, Date.parse('2026-09-18T12:00:00+08:00'))).toBe('2026-09-18')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('版本戳接线（人不用记 mp:stamp-version-date）', () => {
  it('大白话：提交钩子、CI、预览脚本、定版、三端跟上都必须真去戳，拆掉就红', () => {
    expect(pkg.scripts['mp:stamp-version-date']).toContain('stamp-mp-version-date.mjs')
    expect(pkg.scripts['preview:mp']).toMatch(/stamp-mp-version-date/)
    expect(pkg.scripts['device:preview']).toMatch(/stamp-mp-version-date/)
    expect(pkg.scripts['agent:preview']).toMatch(/stamp-mp-version-date/)
    expect(hookSrc).toMatch(/stamp-mp-version-date/)
    expect(stampWfSrc).toMatch(/stamp-mp-version-date/)
    expect(stampWfSrc).toMatch(/branches:\s*\[[^\]]*(main)[^\]]*(test)/s)
    expect(releaseSrc).toContain('stampMpVersionDate')
    expect(macSrc).toContain('stampMpVersionDate')
    expect(stampSrc).not.toMatch(/wechatide.*upload/)
  })
})

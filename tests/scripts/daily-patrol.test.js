import { afterEach, describe, expect, it } from 'vitest'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const sandboxes = []

afterEach(() => {
  for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function executable(path, body) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, body)
  chmodSync(path, 0o755)
}

function runPatrol({ backup, ageHours = 0, audit = 0 } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'daily-patrol-test-'))
  sandboxes.push(root)
  mkdirSync(join(root, 'scripts'), { recursive: true })
  copyFileSync(join(REPO, 'scripts/daily-patrol.sh'), join(root, 'scripts/daily-patrol.sh'))
  writeFileSync(join(root, 'scripts/check-structure.mjs'), '')
  writeFileSync(join(root, 'scripts/check-cert-expiry.mjs'), '')

  const bin = join(root, 'bin')
  executable(
    join(bin, 'git'),
    `#!/bin/sh
case "$1" in
  ls-remote) printf 'abc\\trefs/heads/main\\n' ;;
  rev-parse) echo abc ;;
  rev-list) echo 0 ;;
esac
`,
  )
  executable(join(bin, 'gh'), '#!/bin/sh\necho "[]"\n')
  executable(
    join(bin, 'npm'),
    `#!/bin/sh
echo '{"metadata":{"vulnerabilities":{"high":${audit},"critical":0}}}'
`,
  )

  if (backup) {
    const path = join(root, '.db-backups.local', backup)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, '{}')
    const mtime = new Date(Date.now() - ageHours * 60 * 60 * 1000)
    utimesSync(path, mtime, mtime)
  }

  const result = spawnSync('sh', ['scripts/daily-patrol.sh'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  })
  return { status: result.status, output: result.stdout + result.stderr }
}

describe('daily patrol backup freshness on Linux', () => {
  it('passes when a backup is fresh', () => {
    const result = runPatrol({ backup: 'nightly/backup.json', ageHours: 2 })
    expect(result.status).toBe(0)
    expect(result.output).toContain('✅ 最新备份 2 小时前（.db-backups.local/nightly/backup.json）')
  })

  it('fails when the newest backup is stale', () => {
    const result = runPatrol({ backup: 'nightly/backup.csv', ageHours: 30 })
    expect(result.status).toBe(1)
    expect(result.output).toContain('🔴 最新备份已 30 小时（>26h·.db-backups.local/nightly/backup.csv）')
  })

  it('fails when no backup exists', () => {
    const result = runPatrol()
    expect(result.status).toBe(1)
    expect(result.output).toContain('🔴 .db-backups.local 无产物——备份链断了')
  })

  it('keeps a backup path containing spaces intact', () => {
    const result = runPatrol({ backup: 'nightly copy/backup file.json', ageHours: 1 })
    expect(result.status).toBe(0)
    expect(result.output).toContain('✅ 最新备份 1 小时前（.db-backups.local/nightly copy/backup file.json）')
  })
})

describe('daily patrol audit baseline', () => {
  it('keeps the accepted baseline yellow without failing patrol', () => {
    const result = runPatrol({ backup: 'backup.json', ageHours: 1, audit: 7 })
    expect(result.status).toBe(0)
    expect(result.output).toContain('🟡 high+critical 共 7 条（当前接受基线 7）')
  })

  it('fails when high and critical findings exceed the baseline', () => {
    const result = runPatrol({ backup: 'backup.json', ageHours: 1, audit: 8 })
    expect(result.status).toBe(1)
    expect(result.output).toContain('🔴 high+critical 共 8 条（超过接受基线 7）')
  })
})

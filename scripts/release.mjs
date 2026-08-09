#!/usr/bin/env node
/**
 * 生产发布脚本（定版权在老板，2026-08-08 版本号管理拍板配套）。
 * 作用：升正式版本号 + 打 git tag，一条命令留痕。
 * 用法：node scripts/release.mjs patch|minor|major   （或 npm run release -- patch）
 * 规矩：
 *   - 只允许在 main 分支、工作区干净时跑（防把脏代码/未合入内容定版）。
 *   - 只升号+打 tag，不 push、不部署——推送/部署/merge 仍走既有人工流程。
 *   - agent 不碰本脚本的执行（生产定版权在老板）。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const bump = process.argv[2]
if (!['patch', 'minor', 'major'].includes(bump)) {
  console.error('✗ 用法：node scripts/release.mjs patch|minor|major')
  process.exit(1)
}

// 前置校验：必须在 main、工作区干净
const branch = execSync('git branch --show-current', { cwd: ROOT, encoding: 'utf8' }).trim()
if (branch !== 'main') {
  console.error(`✗ 只在 main 上定版（当前分支：${branch}）。合并后再跑。`)
  process.exit(1)
}
const dirty = execSync('git status --porcelain', { cwd: ROOT, encoding: 'utf8' }).toString().trim()
if (dirty) {
  console.error('✗ 工作区有未提交改动，拒绝定版：\n' + dirty)
  process.exit(1)
}

const pkgPath = join(ROOT, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
const cur = pkg.version || '0.0.0'
const m = cur.match(/^(\d+)\.(\d+)\.(\d+)(-.+)?$/)
if (!m) {
  console.error('✗ 当前版本号无法解析（SemVer）：' + cur)
  process.exit(1)
}
let [, ma, mi, pa] = m.map((x) => (x === undefined ? '' : x))
if (bump === 'major') { ma = String(Number(ma) + 1); mi = '0'; pa = '0' }
else if (bump === 'minor') { mi = String(Number(mi) + 1); pa = '0' }
else { pa = String(Number(pa) + 1) }
const next = `${ma}.${mi}.${pa}`
if (next === cur) { console.error('✗ 版本未变化'); process.exit(1) }

pkg.version = next
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')

// LD-004：同步 lockfile 顶层 version（版本号单源，以 package.json 为准）
const lockPath = join(ROOT, 'package-lock.json')
if (existsSync(lockPath)) {
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'))
  lock.version = next
  if (lock.packages?.['']) {
    lock.packages[''].version = next
  }
  writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n')
}

execSync('git add package.json package-lock.json 2>/dev/null || git add package.json', { cwd: ROOT })
execSync(`git commit -m "release: v${next}"`, { cwd: ROOT, stdio: 'inherit' })
execSync(`git tag v${next}`, { cwd: ROOT })
console.log(`✅ 定版完成：v${cur} → v${next}`)
console.log(`   下一步（人工）：git push origin main --tags  → 部署生产`)

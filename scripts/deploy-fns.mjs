#!/usr/bin/env node
/**
 * 部署自动化（B7）：build:cloud → 按产物内容 hash 算清单 → 与 .deploy-manifest.json diff
 * → 报告变更函数 →（仅 DEPLOY_ALLOWED=1）逐函数 tcb 部署 + 更新清单。切换上线（B9）用。
 *
 * 三道部署保险：① 默认/`--dry-run` 只报告不部署；② 真部署须 `DEPLOY_ALLOWED=1`
 * （样板房永不设置）；③ 实际 tcb 调用仍过 guard-deploy（样板房 deny-all）。
 *
 * 用法：
 *   node scripts/deploy-fns.mjs --dry-run        # 算 diff 报告（无部署，样板房可跑）
 *   DEPLOY_ALLOWED=1 node scripts/deploy-fns.mjs # 真部署（仅生产仓 B9 切换）
 */
import { execSync } from 'node:child_process'
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'

const ROOT = resolve(import.meta.dirname, '..')
const DIST = join(ROOT, 'packages/cloud/dist')
const MANIFEST = join(ROOT, '.deploy-manifest.json')
const ENVID = 'cloudbase-d4gcssqbv06865479'
const dryRun = process.argv.includes('--dry-run')

if (!dryRun && process.env.DEPLOY_ALLOWED !== '1') {
  console.error('❌ 拒绝部署：deploy-fns 真部署须 DEPLOY_ALLOWED=1（样板房禁部署）。算 diff 请用 --dry-run。')
  process.exit(1)
}

// 1. 构建产物
console.log('构建 cloud 产物（build:cloud）…')
execSync('npm run build:cloud', { cwd: ROOT, stdio: 'inherit' })

// 2. 当前清单（函数 → 产物内容 hash）
const cur = {}
for (const name of readdirSync(DIST)) {
  const idx = join(DIST, name, 'index.js')
  if (existsSync(idx)) cur[name] = createHash('sha256').update(readFileSync(idx)).digest('hex').slice(0, 12)
}

// 3. 与已部署清单 diff
const prev = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')).functions || {} : {}
const changed = Object.keys(cur).sort().filter((n) => cur[n] !== prev[n])
const removed = Object.keys(prev).filter((n) => !(n in cur))

console.log(`\n📦 产物 ${Object.keys(cur).length} 个；变更待部署 ${changed.length} 个：${changed.join(' / ') || '（无）'}`)
if (removed.length) console.log(`⚠ 已移除 ${removed.length}（需手动在控制台删）：${removed.join(' / ')}`)

if (dryRun) {
  console.log('\n（--dry-run：只报告，未部署）')
  process.exit(0)
}

// 4. 逐函数部署（敏感函数二次确认由 guard-deploy 兜底）
for (const name of changed) {
  console.log(`\n部署 ${name} …`)
  execSync(`tcb fn deploy ${name} --dir ${join(DIST, name)} --force -e ${ENVID}`, { cwd: ROOT, stdio: 'inherit' })
}

// 5. 更新清单（入 git，记录已部署 hash + 时间）
writeFileSync(MANIFEST, JSON.stringify({ updatedAt: Date.now(), functions: cur }, null, 2) + '\n')
console.log(`\n✅ 部署 ${changed.length} 个函数，.deploy-manifest.json 已更新。`)

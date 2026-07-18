#!/usr/bin/env node
/**
 * 部署自动化：build:rw-cloud → 按产物内容 hash 算清单 → 与 .deploy-manifest.json diff
 * → 报告变更函数 →（仅 DEPLOY_ALLOWED=1）逐函数 tcb 部署 + 更新清单。
 *
 * 【指针大迁移·盲区体检批3·病根#16 ⑤】本脚本曾是 M5 切换（2026-07-09）最大的残留指针：
 * 生产已换 rewrite/cloud 15 函数，这里仍 build:cloud + packages/cloud/dist + 38 函数旧 manifest
 * ——hash 恰好匹配就报「变更待部署 0 个」假全清（app 函数落后 git 半月无人察觉的工具根因）；
 * 不匹配则会把冻结旧线覆盖上生产、复活已删的 26 函数。现已改指活线；旧 manifest 一并删除
 * （云端实际部署版本未知 ⇒ 无清单=全部待部署，是诚实的未知态；首次授权部署后重建真清单）。
 * 守卫 rw-toolchain-no-oldline 防本脚本被改回旧线。
 *
 * 三道部署保险：① 默认/`--dry-run` 只报告不部署；② 真部署须 `DEPLOY_ALLOWED=1`；
 * ③ 实际 tcb 调用仍过 guard-deploy 部署闸（含敏感函数二次确认）。
 *
 * 用法：
 *   node scripts/deploy-fns.mjs --dry-run        # 算 diff 报告（无部署，可随时跑）
 *   DEPLOY_ALLOWED=1 node scripts/deploy-fns.mjs # 真部署（人工授权动作·CLAUDE §3 部署闸）
 */
import { execSync } from 'node:child_process'
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { PROD_ENV as ENVID } from './lib/env.mjs' // 生产 env id 单源（病根#5·债#30①）

const ROOT = resolve(import.meta.dirname, '..')
const DIST = join(ROOT, 'rewrite/cloud/dist') // 生产线产物（M5 后唯一部署源·勿改回 packages/）
const MANIFEST = join(ROOT, '.deploy-manifest.json')
const dryRun = process.argv.includes('--dry-run')

if (!dryRun && process.env.DEPLOY_ALLOWED !== '1') {
  console.error('❌ 拒绝部署：deploy-fns 真部署须 DEPLOY_ALLOWED=1（样板房禁部署）。算 diff 请用 --dry-run。')
  process.exit(1)
}

// 1. 构建产物（活线）
console.log('构建 rewrite/cloud 产物（build:rw-cloud）…')
execSync('npm run build:rw-cloud', { cwd: ROOT, stdio: 'inherit' })

// 2. 当前清单（函数 → 产物内容 hash）
const cur = {}
for (const name of readdirSync(DIST)) {
  const idx = join(DIST, name, 'index.js')
  if (!existsSync(idx)) continue
  // hash 覆盖随产物部署的文件：index.js（恒有）+ config.json（云调用 openapi 权限声明·债#26）
  // + package.json（rewrite build.mjs 每函数生成·deps 声明——@cloudbase/manager-node 增删也该触发重部署）。
  // 只算 index.js 会漏判「仅 config/package 变」→ hash 不变 → 不重部署 → 权限/依赖永不生效
  // （根因#8 部署≠生效·守卫 openapi-perm-declared ③ 锁此）。
  const h = createHash('sha256').update(readFileSync(idx))
  for (const extra of ['config.json', 'package.json']) {
    const fp = join(DIST, name, extra)
    if (existsSync(fp)) h.update(readFileSync(fp))
  }
  cur[name] = h.digest('hex').slice(0, 12)
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

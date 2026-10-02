#!/usr/bin/env node
/**
 * 部署自动化：build:rw-cloud → 按产物内容 hash 算清单 → 与部署账本（最新 deploy-* tag）diff
 * → 报告变更函数 →（仅 DEPLOY_ALLOWED=1）逐函数 tcb 部署 → 打 deploy-<UTC时间> tag 记账并推送。
 *
 * 【指针大迁移·盲区体检批3·病根#16 ⑤】本脚本曾是 M5 切换（2026-07-09）最大的残留指针：
 * 生产已换 rewrite/cloud 15 函数，这里仍 build:cloud + packages/cloud/dist + 38 函数旧 manifest
 * ——hash 恰好匹配就报「变更待部署 0 个」假全清（app 函数落后 git 半月无人察觉的工具根因）；
 * 不匹配则会把冻结旧线覆盖上生产、复活已删的 26 函数。现已改指活线；旧 manifest 一并删除
 * （云端实际部署版本未知 ⇒ 无清单=全部待部署，是诚实的未知态；首次授权部署后重建真清单）。
 *
 * 三道部署保险：① 默认/`--dry-run` 只报告不部署；② 真部署须 `DEPLOY_ALLOWED=1`；
 * ③ 跑本脚本本身就过 guard-deploy 部署闸确认（Claude 会话内）；④ 真部署只从「干净的、等于 origin/main 的 main」发
 * （deployBlockers）——此前任意 worktree/分支/落后的本地都能直接发上线。
 *
 * 账本（2026-10-02）：部署完打注释 tag `deploy-<UTC时间>`（指向本次部署的提交，正文＝各函数 hash JSON），
 * 只推 tag、不推 main。中途某函数失败也照样记下已发出去的那几个。回滚目标＝上一个 deploy-* tag。
 *
 * 用法：
 *   node scripts/deploy-fns.mjs --dry-run        # 算 diff 报告（无部署，可随时跑）
 *   DEPLOY_ALLOWED=1 node scripts/deploy-fns.mjs # 真部署（人工授权动作·CLAUDE.md 部署闸）
 */
import { execSync } from 'node:child_process'
import { readdirSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { PROD_ENV as ENVID } from './lib/env.mjs' // 生产 env id 单源（病根#5·债#30①）
import { deployTargets } from './lib/deploy-aliases.mjs' // 产物→云函数名映射单源（别名册已空·adminApi 只部署自身）
// 产物 hash / 账本 / 部署前提单源（preflight 同源）
import { deployBlockers, hashFnDist, readDeployLedger } from './lib/deploy-drift.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const DIST = join(ROOT, 'rewrite/cloud/dist') // 生产线产物（M5 后唯一部署源·勿改回 packages/）
const dryRun = process.argv.includes('--dry-run')
const git = (args, opts = {}) => execSync(`git ${args}`, { cwd: ROOT, encoding: 'utf8', ...opts }).trim()

if (!dryRun && process.env.DEPLOY_ALLOWED !== '1') {
  console.error('❌ 拒绝部署：deploy-fns 真部署须 DEPLOY_ALLOWED=1（样板房禁部署）。算 diff 请用 --dry-run。')
  process.exit(1)
}

// 0. 拉最新 main 与账本 tag；真部署再核「干净的、等于 origin/main 的 main」
try {
  git('fetch -q origin main --tags')
} catch (e) {
  if (!dryRun) throw e
  console.warn('⚠ git fetch 失败，账本按本地 tag 算（可能过时）')
}
if (!dryRun) {
  const blockers = deployBlockers({
    branch: git('branch --show-current'),
    head: git('rev-parse HEAD'),
    originMain: git('rev-parse origin/main'),
    // 已跟踪文件的任何改动 + rewrite/ 下未跟踪文件（会被打进产物）；dist 在 .gitignore 里不算
    dirty: [git('status --porcelain -uno'), git('status --porcelain -- rewrite')].filter(Boolean).join('\n'),
  })
  if (blockers.length) {
    console.error('❌ 拒绝部署：\n- ' + blockers.join('\n- '))
    process.exit(1)
  }
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
  // + package.json 除 version 外（deps 声明——@cloudbase/manager-node 增删也该触发重部署；version 是
  // 构建戳 `0.0.0-<sha>`，参与 hash 会让每次提交都全量重部署、diff 失去分辨力·2026-08-03 回归修复）。
  // 只算 index.js 会漏判「仅 config/package 变」→ hash 不变 → 不重部署 → 权限/依赖永不生效（根因#8）。
  // 算法单源＝scripts/lib/deploy-drift.mjs（preflight 与本脚本同一实现，不再各留镜像）。
  cur[name] = hashFnDist(DIST, name)
}

// 3. 与部署账本 diff
const ledger = readDeployLedger(ROOT)
const prev = ledger.functions
const changed = Object.keys(cur).sort().filter((n) => cur[n] !== prev[n])
const removed = Object.keys(prev).filter((n) => !(n in cur))

console.log(`\n账本：${ledger.source}`)
console.log(`📦 产物 ${Object.keys(cur).length} 个；变更待部署 ${changed.length} 个：${changed.join(' / ') || '（无）'}`)
if (removed.length) console.log(`⚠ 已移除 ${removed.length}（需手动在控制台删）：${removed.join(' / ')}`)

if (dryRun) {
  console.log('\n（--dry-run：只报告，未部署）')
  process.exit(0)
}

// 4. 逐函数部署；成功一个记一个，中途失败也把已发出去的记进账（finally）
const functions = Object.fromEntries(Object.keys(cur).filter((n) => prev[n]).map((n) => [n, prev[n]]))
const deployed = []
try {
  for (const name of changed) {
    // 别名展开入口仍在：DEPLOY_ALIASES 空则 deployTargets(name) === [name]。
    // 2026-08-13 起 adminApi 只发自身，不要再部署 adminApiV2。
    for (const target of deployTargets(name)) {
      console.log(`\n部署 ${target}${target === name ? '' : `（${name} 产物·部署别名）`} …`)
      execSync(`tcb fn deploy ${target} --dir ${join(DIST, name)} --force -e ${ENVID}`, { cwd: ROOT, stdio: 'inherit' })
    }
    functions[name] = cur[name]
    deployed.push(name)
  }
} finally {
  // 5. 记账：注释 tag 指向本次部署的提交（前提已核 HEAD＝origin/main），只推 tag
  if (deployed.length) {
    const sha = git('rev-parse HEAD')
    const tag = `deploy-${new Date().toISOString().replace(/[-:]|\.\d+/g, '')}` // deploy-20261002T073112Z
    git(`tag -a ${tag} -F -`, { input: JSON.stringify({ sha, deployed, functions }, null, 2) + '\n' })
    console.log(`\n🏷  已记账 ${tag}（${sha.slice(0, 8)}）：${deployed.join(' / ')}`)
    try {
      git(`push -q origin ${tag}`)
    } catch {
      console.error(`⚠ tag 推送失败，账本只在本机——请手动：git push origin ${tag}`)
    }
  }
}
console.log(`\n✅ 部署 ${deployed.length} 个函数。`)

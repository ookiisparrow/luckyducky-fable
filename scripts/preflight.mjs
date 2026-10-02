#!/usr/bin/env node
/**
 * 部署前置体检（B9 preflight）：一条命令确认「可部署」。只读、不部署、不改任何东西。
 * 机器自动核：质量闸全绿 / 生产线（rewrite/cloud）钱链函数无未部署漂移（对照部署账本＝最新 deploy-* tag）/
 *            console-assets 正册齐。
 * 再打印机器够不到、须人工核的清单（console-assets drift / 验收单）。
 * 详见 docs/运维手册.md「出事与上线」（部署后 smoke）。
 */
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { MONEY_CHAIN, detectDrift, hashFnDist, readDeployLedger } from './lib/deploy-drift.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const pass = []
const fail = []
const run = (label, fn) => {
  try {
    fn()
    pass.push(label)
  } catch (e) {
    fail.push(`${label} —— ${e.message}`)
  }
}

run('质量闸全绿（npm run check）', () => {
  execSync('npm run check', { cwd: ROOT, stdio: 'pipe' })
})
run('生产线（rewrite/cloud）钱链函数无未部署漂移（根因#8）', () => {
  // 构建活线产物。cloudbaserc.json 的 functionRoot 已是 rewrite/cloud/dist；
  // 这里只需要 dist 字节，故独立跑 build:rw-cloud。
  // 2026-06-16 实测漏洞：钱链 [LD_ALERT]/支付窗口 改了 4 天没部署，而 preflight 原只验结构、不验
  // 「部署时效」——本项补这洞。hash 算法（index.js+config.json+package.json）与 deploy-fns.mjs
  // 部署时逐字节一致（hashFnDist 单源，见 scripts/lib/deploy-drift.mjs 头注）。
  execSync('npm run build:rw-cloud', { cwd: ROOT, stdio: 'pipe' })
  const dist = join(ROOT, 'rewrite/cloud/dist')
  try {
    execSync('git fetch -q origin --tags', { cwd: ROOT, stdio: 'pipe' }) // 账本 tag 由部署机推上来，先拉
  } catch {
    // 离线就按本地 tag 算
  }
  const { source, functions: deployed } = readDeployLedger(ROOT)
  pass.push(`部署账本：${source}`)
  const cur = {}
  for (const fn of MONEY_CHAIN) {
    const h = hashFnDist(dist, fn)
    if (h) cur[fn] = h
  }
  const drift = detectDrift(cur, deployed, MONEY_CHAIN)
  if (drift.length) throw new Error(`钱链改了未部署：${drift.join(', ')}——先 DEPLOY_ALLOWED=1 deploy-fns`)
})
run('console-assets 正册齐（6 件）', () => {
  // 与 console-assets/README.md 目录一致：README 自己 + 正册五件。
  for (const f of [
    'README.md',
    '01-支付退款工作流.md',
    'forward-node.js',
    '02-库权限期望表.md',
    '03-复合索引期望表.md',
    '04-视频点播VOD.md',
  ])
    if (!existsSync(join(ROOT, 'console-assets', f))) throw new Error(`缺 ${f}`)
})

console.log('\n===== 部署前置体检（preflight）=====')
for (const p of pass) console.log(`  ✅ ${p}`)
for (const f of fail) console.log(`  ❌ ${f}`)
console.log(`\n机器体检：${fail.length ? `❌ ${fail.length} 项未过——先修，别部署` : '✅ 全过'}`)
console.log(`
还须人工核（机器够不到，详见 docs/运维手册.md「出事与上线」）：
  □ console-assets drift-checklist：对照线上控制台逐项核（forward-node.js / flowId / 库权限期望表）
  □ 验收单 X（集合权限档位·以 COLLECTIONS 单源为准）/ Y（支付黄金路径）/ Z（退款黄金路径）真机重走
  □ cloudbaserc.json：functionRoot 已是 rewrite/cloud/dist。部署源就是这份活线产物。
    函数个数、内存、超时以 cloudbaserc.json 的 functions 为准。
  □ 数据兼容：重构 _id 方案与现网一致＝无需迁移；债#14（users/progress 确定性_id）属切换后改进
真部署（deploy-fns）须 DEPLOY_ALLOWED=1 + 用户拍板。本体检不触发任何部署。`)
process.exit(fail.length ? 1 : 0)

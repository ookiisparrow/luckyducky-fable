#!/usr/bin/env node
/**
 * 部署前置体检（B9 preflight）：一条命令确认「可部署」。只读、不部署、不改任何东西。
 * 机器自动核：质量闸全绿 / 生产线（rewrite/cloud）钱链函数无未部署漂移 / console-assets 正册齐 /
 *            .deploy-manifest 在册。
 * 再打印机器够不到、须人工核的清单（console-assets drift / 验收单 / cloudbaserc 迁移）。
 * 详见 docs/运维手册.md §⑦（部署后 smoke）。
 */
import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { MONEY_CHAIN, detectDrift, hashFnDist } from './lib/deploy-drift.mjs'

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
  // 构建活线产物（原 build:cloud 结构检查块已退役——functionRoot/内存/超时等 cloudbaserc 迁移
  // 待人工先抄回控制台真值，见 footer 提醒；这里只需要 dist 字节，故独立跑 build:rw-cloud）。
  // 2026-06-16 实测漏洞：钱链 [LD_ALERT]/支付窗口 改了 4 天没部署，而 preflight 原只验结构、不验
  // 「部署时效」——本项补这洞。hash 算法（index.js+config.json+package.json）与 deploy-fns.mjs
  // 部署时逐字节一致（hashFnDist 单源，见 scripts/lib/deploy-drift.mjs 头注）。
  execSync('npm run build:rw-cloud', { cwd: ROOT, stdio: 'pipe' })
  const dist = join(ROOT, 'rewrite/cloud/dist')
  const deployed = JSON.parse(readFileSync(join(ROOT, '.deploy-manifest.json'), 'utf8')).functions || {}
  const cur = {}
  for (const fn of MONEY_CHAIN) {
    const h = hashFnDist(dist, fn)
    if (h) cur[fn] = h
  }
  const drift = detectDrift(cur, deployed, MONEY_CHAIN)
  if (drift.length) throw new Error(`钱链改了未部署：${drift.join(', ')}——先 DEPLOY_ALLOWED=1 deploy-fns`)
})
run('console-assets 正册齐（4 件）', () => {
  for (const f of ['README.md', '01-支付退款工作流.md', '02-库权限期望表.md', 'forward-node.js'])
    if (!existsSync(join(ROOT, 'console-assets', f))) throw new Error(`缺 ${f}`)
})
run('.deploy-manifest.json 在册', () => {
  if (!existsSync(join(ROOT, '.deploy-manifest.json'))) throw new Error('缺')
})

console.log('\n===== 部署前置体检（preflight）=====')
for (const p of pass) console.log(`  ✅ ${p}`)
for (const f of fail) console.log(`  ❌ ${f}`)
console.log(`\n机器体检：${fail.length ? `❌ ${fail.length} 项未过——先修，别部署` : '✅ 全过'}`)
console.log(`
还须人工核（机器够不到，详见 docs/运维手册.md §⑦）：
  □ console-assets drift-checklist：对照线上控制台逐项核（forward-node.js / flowId / 库权限期望表）
  □ 验收单 X（集合权限档位·以 COLLECTIONS 单源为准）/ Y（支付黄金路径）/ Z（退款黄金路径）真机重走
  □ cloudbaserc.json 迁移：functionRoot 仍指旧线冻结产物目录，迁至活线产物目录前须先
    tcb fn detail 逐个抄回全部函数真实内存/超时值（以 cloudbaserc.json functions 为准）——仓内无记录，凭空写会在下次 config 应用时降级
    生产配置（见 docs/待办与债.md 该 flag）
  □ 数据兼容：重构 _id 方案与现网一致＝无需迁移；债#14（users/progress 确定性_id）属切换后改进
真部署（deploy-fns）须 DEPLOY_ALLOWED=1 + 用户拍板。本体检不触发任何部署。`)
process.exit(fail.length ? 1 : 0)

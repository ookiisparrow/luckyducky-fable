#!/usr/bin/env node
/**
 * 切换前体检（B9 preflight）：一条命令确认样板房「可切换」。只读、不部署、不改任何东西。
 * 机器自动核：质量闸全绿 / build:cloud 产物 27 个 / console-assets 正册齐 /
 *            .deploy-manifest 在册 / cloudbaserc 指向 packages/cloud/dist。
 * 再打印机器够不到、须人工核的清单（drift / 验收单 / CLAUDE reconcile）。
 * 详见 docs/切换runbook.md。
 */
import { execSync } from 'node:child_process'
import { readdirSync, existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

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
run('build:cloud 产物 = 28 个函数', () => {
  execSync('npm run build:cloud', { cwd: ROOT, stdio: 'pipe' })
  const dist = join(ROOT, 'packages/cloud/dist')
  const n = existsSync(dist)
    ? readdirSync(dist).filter((d) => existsSync(join(dist, d, 'index.js'))).length
    : 0
  if (n !== 28) throw new Error(`产物 ${n} 个 ≠ 28`)
})
run('console-assets 正册齐（4 件）', () => {
  for (const f of ['README.md', '01-支付退款工作流.md', '02-库权限期望表.md', 'forward-node.js'])
    if (!existsSync(join(ROOT, 'console-assets', f))) throw new Error(`缺 ${f}`)
})
run('.deploy-manifest.json 在册', () => {
  if (!existsSync(join(ROOT, '.deploy-manifest.json'))) throw new Error('缺')
})
run('cloudbaserc functionRoot → packages/cloud/dist', () => {
  const c = JSON.parse(readFileSync(join(ROOT, 'cloudbaserc.json'), 'utf8'))
  if (c.functionRoot !== 'packages/cloud/dist') throw new Error(`现为 ${c.functionRoot}`)
})

console.log('\n===== 切换前体检（preflight）=====')
for (const p of pass) console.log(`  ✅ ${p}`)
for (const f of fail) console.log(`  ❌ ${f}`)
console.log(`\n机器体检：${fail.length ? `❌ ${fail.length} 项未过——先修，别切换` : '✅ 全过'}`)
console.log(`
还须人工核（机器够不到，详见 docs/切换runbook.md）：
  □ console-assets drift-checklist：对照线上控制台逐项核（forward-node.js / flowId / 库权限期望表）
  □ 验收单 X（16 集合权限档位）/ Y（支付黄金路径）/ Z（退款黄金路径）真机重走
  □ CLAUDE 本体 §2/§5/§7 reconcile 到重构后架构（packages//cloud-kit/api-cloud-only/八闸）
  □ 数据兼容：重构 _id 方案与现网一致＝无需迁移；债#14（users/progress 确定性_id）属切换后改进
切换动作（deploy-fns 真跑）须 DEPLOY_ALLOWED=1 + 用户拍板。本体检不触发任何部署。`)
process.exit(fail.length ? 1 : 0)

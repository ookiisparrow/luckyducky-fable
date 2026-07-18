#!/usr/bin/env node
/**
 * 部署到【测试环境】（债#19 配套）——把生产线（rewrite/cloud）函数部署到测试 env。
 *
 * 【指针大迁移·盲区体检批3·病根#16 ⑤】原版 build:cloud + 读 cloudbaserc.json 旧 38 函数清单
 * ＝把冻结旧线部署到测试环境（M5 后测试的不是生产跑的代码）。现改：build:rw-cloud + 函数清单
 * 直接从 rewrite/cloud/dist 产物目录取（与 deploy-fns 同源·不再依赖 cloudbaserc 旧清单——
 * cloudbaserc 的迁移需先从控制台抄回 14 函数真实内存/超时值，见 待办与债 盲区体检节）。
 * **物理防误部署生产**：env 等于生产 envId 直接中止。本脚本在你自己终端跑（不经部署闸 hook）。
 *
 * 用法：node scripts/deploy-test.mjs --env <测试envId>
 *   或：LD_TEST_ENV=<测试envId> npm run deploy:test
 * 前置：tcb 已登录（tcb login）；脚本会先 npm run build:rw-cloud。
 * 注：tcb 命令以你本机 tcb 版本为准——flag 对不上就按上面 tcb 报错改本脚本那一行。
 */
import { readdirSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { PROD_ENV } from './lib/env.mjs' // 生产 env id 单源（病根#5·债#30①）·禁部署

const ROOT = resolve(import.meta.dirname, '..')

function arg(name) {
  const i = process.argv.indexOf('--' + name)
  return i >= 0 ? process.argv[i + 1] : ''
}

const env = arg('env') || process.env.LD_TEST_ENV || ''
if (!env) {
  console.error('✗ 缺测试 envId：node scripts/deploy-test.mjs --env <env>（或 LD_TEST_ENV=...）')
  process.exit(1)
}
if (env === PROD_ENV) {
  console.error('✗ 拒绝：目标是生产环境 ' + PROD_ENV + '——本脚本只部署测试环境')
  process.exit(1)
}

console.log('构建云函数（build:rw-cloud）…')
execSync('npm run build:rw-cloud', { stdio: 'inherit', cwd: ROOT })

// 函数清单=活线产物目录（与 deploy-fns 同源·dist/<fn>/index.js 存在即一个函数）
const DIST = join(ROOT, 'rewrite/cloud/dist')
const fns = existsSync(DIST) ? readdirSync(DIST).filter((n) => existsSync(join(DIST, n, 'index.js'))) : []
if (!fns.length) {
  console.error('✗ rewrite/cloud/dist 无函数产物（build:rw-cloud 失败？）')
  process.exit(1)
}
console.log(`部署 ${fns.length} 个函数 → 测试环境 ${env}`)
for (const name of fns) {
  console.log(`  → ${name}`)
  try {
    // --dir 显式指活线产物：不带 --dir 时 tcb 会按 cloudbaserc.json 的 functionRoot 取源，
    // 而 cloudbaserc 仍指旧线（迁移需先抄回控制台真实函数配置，见 待办与债）——不显式即部署错线
    execSync(`tcb fn deploy ${name} --dir ${join(DIST, name)} -e ${env} --force`, { stdio: 'inherit', cwd: ROOT })
  } catch {
    console.error(`  ✗ ${name} 部署失败（看上面 tcb 输出；flag 不符就改本脚本的 tcb 行）`)
    process.exit(1)
  }
}
console.log('✅ 测试环境部署完成：' + env)

#!/usr/bin/env node
/**
 * 部署到【测试环境】（债#19 配套）——把 cloudbaserc.json 里的函数部署到测试 env。
 *
 * 复用同一份函数清单（不另存一份 cloudbaserc·防漂移）；**物理防误部署生产**：env 等于生产 envId
 * 直接中止。注意：本脚本在你自己终端跑（不经 Claude Code 的部署闸 hook）。
 *
 * 用法：node scripts/deploy-test.mjs --env <测试envId>
 *   或：LD_TEST_ENV=<测试envId> npm run deploy:test
 * 前置：tcb 已登录（tcb login）；脚本会先 npm run build:cloud。
 * 注：tcb 命令以你本机 tcb 版本为准——flag 对不上就按上面 tcb 报错改本脚本那一行。
 */
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join, resolve } from 'node:path'

const PROD_ENV = 'cloudbase-d4gcssqbv06865479' // 生产·禁部署
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

const cfg = JSON.parse(readFileSync(join(ROOT, 'cloudbaserc.json'), 'utf8'))
const fns = (cfg.functions || []).map((f) => f.name)
if (!fns.length) {
  console.error('✗ cloudbaserc.json 无函数清单')
  process.exit(1)
}

console.log('构建云函数（build:cloud）…')
execSync('npm run build:cloud', { stdio: 'inherit', cwd: ROOT })
console.log(`部署 ${fns.length} 个函数 → 测试环境 ${env}`)
for (const name of fns) {
  console.log(`  → ${name}`)
  try {
    execSync(`tcb fn deploy ${name} -e ${env} --force`, { stdio: 'inherit', cwd: ROOT })
  } catch {
    console.error(`  ✗ ${name} 部署失败（看上面 tcb 输出；flag 不符就改本脚本的 tcb 行）`)
    process.exit(1)
  }
}
console.log('✅ 测试环境部署完成：' + env)

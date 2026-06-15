#!/usr/bin/env node
/**
 * 压测台骨架（债#19）——并发正确性 + 种子容量，**只打独立测试环境，绝不碰生产**。
 *
 * 为什么：本仓从未压测、全靠看码推断（根因#8「单人能用 ≠ 千人同时」）。两件事要分清：
 *   ① 并发正确性（同 key 突发会不会算错/重复）——能廉价真证：Promise.all 灌并发 + 断言不变量。
 *   ② 吞吐/容量（峰值扛不扛、破千准不准）——需真环境真量：种子灌数 + 量延迟 + 核精确。
 * 二者只有对**真测试环境**跑才算「证」（桩测只证逻辑自洽，不证真库行为）。
 *
 * 前置（靠人，缺一不可）：
 *   1) 一个【独立测试 tcb 环境】——绝不用生产（cloudbase-d4gcssqbv06865479）。
 *   2) npm i -D @cloudbase/node-sdk
 *   3) 测试环境服务凭证：环境变量 TCB_SECRETID / TCB_SECRETKEY（或改用 CLI 登录态）。
 *   4) 把云函数部署到该测试环境（build:cloud + 部署）。
 *
 * 用法：
 *   node scripts/loadtest.mjs --env <测试envId> --mode concurrency --n 100
 *   node scripts/loadtest.mjs --env <测试envId> --mode capacity --seed 2000
 *
 * 安全闸：--env 等于生产 envId 直接退出，绝不跑。
 */

const PROD_ENV = 'cloudbase-d4gcssqbv06865479' // 生产·禁压

function parseArgs(argv) {
  const a = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) a[argv[i].slice(2)] = argv[i + 1]
  }
  return a
}

function usage(msg) {
  if (msg) console.error('✗ ' + msg)
  console.error(
    '用法：node scripts/loadtest.mjs --env <测试envId> --mode <concurrency|capacity> [--n 100] [--seed 2000]'
  )
  process.exit(1)
}

async function getApp(env) {
  let cloudbase
  try {
    cloudbase = (await import('@cloudbase/node-sdk')).default
  } catch {
    usage('缺依赖：先 npm i -D @cloudbase/node-sdk')
  }
  return cloudbase.init({
    env,
    secretId: process.env.TCB_SECRETID,
    secretKey: process.env.TCB_SECRETKEY,
  })
}

// ① 并发正确性：N 个并发 trackEvent（同 openid）→ 断言恰 max 个未限频、其余 RATE_LIMITED（债#21）。
// 真证 throttle CAS 在真库的原子性（桩只证逻辑·根因#8）。其余不变量（激活码一码一用 / 订单幂等）
// 照此模式补：同 key 灌并发 → 断言「只 N 个生效」。
async function runConcurrency(app, n) {
  const call = (name, data) => app.callFunction({ name, data }).then((r) => r.result)
  const MAX = 60 // 与 withRateLimit('trackEvent', {max:60}) 对齐
  console.log(`并发正确性：${n} 个并发 trackEvent（同 openid）·限频阈值 ${MAX}/分…`)
  const results = await Promise.all(
    Array.from({ length: n }, () => call('trackEvent', { type: 'view', page: 'loadtest' }))
  )
  const limited = results.filter((r) => r && r.error === 'RATE_LIMITED').length
  const passed = n - limited
  console.log(`  放行 ${passed} · 限频 ${limited}`)
  const expectPassed = Math.min(n, MAX)
  if (passed === expectPassed) console.log('  ✅ 限频精确（突发并发下无丢更新）')
  else console.log(`  ❌ 限频漂移：放行 ${passed}，期望 ${expectPassed}（CAS 在真库未严格生效？）`)
}

// ② 种子容量：灌 seed 条假订单 → 量 getDashboard 延迟 + 核 count()/aggregate 破千仍准（债#18/#18续）。
// 直连测试库写入（admin 凭证）；务必是测试环境。
async function runCapacity(app, seed) {
  const db = app.database()
  console.log(`种子容量：灌 ${seed} 条假订单到测试库…`)
  const now = Date.now()
  for (let i = 0; i < seed; i++) {
    await db.collection('orders').add({
      data: { id: 'lt-' + i, amount: 1, status: 'paid', createdAt: now + i, _loadtest: true },
    })
  }
  console.log('  调 getDashboard 量延迟…')
  const t0 = Date.now()
  const r = await app.callFunction({ name: 'adminApi', data: { action: 'getDashboard' } })
  const ms = Date.now() - t0
  const stats = r.result && r.result.stats
  console.log(`  getDashboard 耗时 ${ms}ms · orders=${stats && stats.orders} · gmv=${stats && stats.gmv}`)
  console.log('  ⚠️ 跑完记得清理 _loadtest:true 的种子数据（避免污染测试库）。')
}

async function main() {
  const a = parseArgs(process.argv.slice(2))
  if (!a.env) usage('缺 --env <测试envId>')
  if (a.env === PROD_ENV) usage('拒绝：--env 是生产环境，压测只打独立测试环境')
  const app = await getApp(a.env)
  if (a.mode === 'concurrency') await runConcurrency(app, Number(a.n) || 100)
  else if (a.mode === 'capacity') await runCapacity(app, Number(a.seed) || 2000)
  else usage('--mode 须为 concurrency 或 capacity')
}

main().catch((e) => {
  console.error('压测出错：', e && e.message)
  process.exit(1)
})
